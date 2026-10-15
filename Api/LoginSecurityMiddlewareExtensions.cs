namespace Api;

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public static class LoginSecurityMiddlewareExtensions
{
    internal const string LoginIdentifierItemKey = "Tsundoku.LoginIdentifier";
    private const string LoginPath = "/api/v1/account/login";

    public static IApplicationBuilder UseLoginSecurity(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            var isLogin = HttpMethods.IsPost(context.Request.Method) &&
                          context.Request.Path.Equals(LoginPath, StringComparison.OrdinalIgnoreCase);
            var startedAt = Stopwatch.GetTimestamp();

            if (isLogin)
            {
                context.Items[LoginIdentifierItemKey] = await ReadIdentifierHashAsync(context);
                context.Response.OnStarting(async () =>
                {
                    if (context.Response.StatusCode != StatusCodes.Status401Unauthorized)
                    {
                        return;
                    }

                    var minimumMilliseconds =
                        context.RequestServices.GetRequiredService<IConfiguration>()
                            .GetValue<int?>("Authentication:MinimumFailureResponseMilliseconds") ?? 250;
                    var elapsed = Stopwatch.GetElapsedTime(startedAt);
                    var remaining = TimeSpan.FromMilliseconds(minimumMilliseconds) - elapsed;
                    if (remaining > TimeSpan.Zero)
                    {
                        await Task.Delay(remaining, context.RequestAborted);
                    }
                });
            }

            await next();
        });
    }

    private static async Task<string> ReadIdentifierHashAsync(HttpContext context)
    {
        context.Request.EnableBuffering();
        try
        {
            using var document = await JsonDocument.ParseAsync(
                context.Request.Body,
                cancellationToken: context.RequestAborted);
            var root = document.RootElement;
            var identifier = ReadString(root, "username") ?? ReadString(root, "email");
            if (!string.IsNullOrWhiteSpace(identifier))
            {
                var normalized = identifier.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
                return Convert.ToHexString(
                    SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
            }
        }
        catch (JsonException)
        {
            // MVC handles malformed JSON; the limiter uses a non-sensitive fallback key.
        }
        finally
        {
            context.Request.Body.Position = 0;
        }

        return "missing";
    }

    private static string? ReadString(JsonElement root, string propertyName)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var property in root.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.String &&
                property.Name.Equals(propertyName, StringComparison.OrdinalIgnoreCase))
            {
                return property.Value.GetString();
            }
        }

        return null;
    }
}
