namespace Api.Observability;

using System.Data;
using System.Text.RegularExpressions;
using Infrastructure.BookFiles;
using Infrastructure.Observability;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog.Events;
using Serilog.Sinks.OpenTelemetry;

public static class ObservabilityExtensions
{
    private const string OtlpEndpointVariable = "OTEL_EXPORTER_OTLP_ENDPOINT";
    private const string DeploymentEnvironmentAttribute = "deployment.environment";

    private static readonly Regex SqlOperationPattern = new(
        @"^\s*(?:/\*.*?\*/\s*)*(?<operation>SELECT|INSERT|UPDATE|DELETE|MERGE|EXEC(?:UTE)?)\b",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase | RegexOptions.Singleline);

    private static readonly Regex SqlRelationPattern = new(
        @"\b(?:FROM|INTO|UPDATE)\s+(?<relation>(?:\[[^\]]+\]|""[^""]+""|`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:\[[^\]]+\]|""[^""]+""|`[^`]+`|[A-Za-z_][\w$]*))*)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    public static void AddObservability(this WebApplicationBuilder builder)
    {
        builder.Host.UseSerilog((context, services, logger) =>
        {
            logger
                .ReadFrom.Configuration(context.Configuration)
                .ReadFrom.Services(services)
                .Enrich.FromLogContext()
                .Enrich.WithProperty("Application", "Tsundoku")
                .Enrich.WithProperty("ServiceName", GetServiceName(context.Configuration));

            var endpoint = context.Configuration[OtlpEndpointVariable];
            if (!string.IsNullOrWhiteSpace(endpoint))
            {
                logger.WriteTo.OpenTelemetry(options =>
                {
                    options.Endpoint = endpoint;
                    options.Protocol = OtlpProtocol.Grpc;
                    options.RestrictedToMinimumLevel = LogEventLevel.Information;
                    options.ResourceAttributes = new Dictionary<string, object>
                    {
                        ["service.name"] = GetServiceName(context.Configuration),
                        [DeploymentEnvironmentAttribute] = context.HostingEnvironment.EnvironmentName
                    };
                });
            }
        });

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(resource => resource
                .AddService(GetServiceName(builder.Configuration))
                .AddAttributes(new Dictionary<string, object>
                {
                    [DeploymentEnvironmentAttribute] = builder.Environment.EnvironmentName
                }))
            .WithTracing(tracing =>
            {
                tracing
                    .AddSource(TsundokuTelemetry.ActivitySourceName)
                    .AddSource(InfrastructureTelemetry.ActivitySourceName)
                    .AddAspNetCoreInstrumentation(options =>
                    {
                        options.Filter = context => !IsHealthCheckPath(context.Request.Path);
                    })
                    .AddEntityFrameworkCoreInstrumentation(options =>
                    {
                        options.EnrichWithIDbCommand = (activity, command) =>
                        {
                            var dbCommand = DescribeDbCommand(command);
                            activity.DisplayName = dbCommand.DisplayName;
                            activity.SetTag("db.system", GetDbSystem(command));
                            activity.SetTag("db.operation.name", dbCommand.Operation);

                            if (!string.IsNullOrWhiteSpace(dbCommand.Relation))
                            {
                                activity.SetTag("db.collection.name", dbCommand.Relation);
                            }

                            if (command.CommandType == CommandType.Text)
                            {
                                activity.SetTag("db.statement", command.CommandText);
                            }
                            else if (!string.IsNullOrWhiteSpace(command.CommandText))
                            {
                                activity.SetTag("db.statement.name", command.CommandText);
                            }
                        };
                    })
                    .AddHttpClientInstrumentation();

                AddOtlpTracingExporter(tracing, builder.Configuration);
            })
            .WithMetrics(metrics =>
            {
                metrics
                    .AddMeter(TsundokuTelemetry.MeterName, BookFileTelemetry.Meter.Name)
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddRuntimeInstrumentation();

                AddOtlpMetricsExporter(metrics, builder.Configuration);
            });
    }

    private static void AddOtlpTracingExporter(TracerProviderBuilder tracing, IConfiguration configuration)
    {
        var endpoint = configuration[OtlpEndpointVariable];
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            return;
        }

        tracing.AddOtlpExporter(options => { options.Endpoint = new Uri(endpoint); });
    }

    private static void AddOtlpMetricsExporter(MeterProviderBuilder metrics, IConfiguration configuration)
    {
        var endpoint = configuration[OtlpEndpointVariable];
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            return;
        }

        metrics.AddOtlpExporter(options => { options.Endpoint = new Uri(endpoint); });
    }

    private static string GetDbSystem(IDbCommand command)
    {
        var provider = command.GetType().Namespace ?? string.Empty;
        if (provider.Contains("Npgsql", StringComparison.OrdinalIgnoreCase))
        {
            return "postgresql";
        }

        if (provider.Contains("SqlClient", StringComparison.OrdinalIgnoreCase))
        {
            return "mssql";
        }

        if (provider.Contains("Sqlite", StringComparison.OrdinalIgnoreCase))
        {
            return "sqlite";
        }

        return "database";
    }

    private static DbCommandDescription DescribeDbCommand(IDbCommand command)
    {
        if (command.CommandType != CommandType.Text || string.IsNullOrWhiteSpace(command.CommandText))
        {
            var commandOperation = command.CommandType.ToString().ToUpperInvariant();
            return new DbCommandDescription($"DB {commandOperation}", commandOperation, null);
        }

        var operationMatch = SqlOperationPattern.Match(command.CommandText);
        var operation = operationMatch.Success
            ? operationMatch.Groups["operation"].Value.ToUpperInvariant()
            : "QUERY";
        var relationMatch = SqlRelationPattern.Match(command.CommandText);
        var relation = relationMatch.Success
            ? relationMatch.Groups["relation"].Value.Trim('"', '`', '[', ']')
            : null;

        var displayName = string.IsNullOrWhiteSpace(relation)
            ? $"DB {operation}"
            : $"{operation} {relation}";

        return new DbCommandDescription(displayName, operation, relation);
    }

    private static string GetServiceName(IConfiguration configuration)
    {
        return configuration["OTEL_SERVICE_NAME"] ?? "tsundoku-api";
    }

    public static bool IsHealthCheckPath(PathString path)
    {
        return path.StartsWithSegments("/health", StringComparison.OrdinalIgnoreCase);
    }

    private sealed record DbCommandDescription(string DisplayName, string Operation, string? Relation);
}
