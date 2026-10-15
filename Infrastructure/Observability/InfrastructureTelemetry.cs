namespace Infrastructure.Observability;

using System.Diagnostics;

public static class InfrastructureTelemetry
{
    public const string ActivitySourceName = "Tsundoku.Infrastructure";

    public static readonly ActivitySource ActivitySource = new(ActivitySourceName);
}
