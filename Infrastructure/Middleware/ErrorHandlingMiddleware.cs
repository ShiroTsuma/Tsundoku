using ValidationException = FluentValidation.ValidationException;

namespace Infrastructure.Middleware;

using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Services;

public class ErrorHandlingMiddleware
{
    private readonly ILogger<ErrorHandlingMiddleware> _logger;
    private readonly RequestDelegate _next;

    public ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext httpContext)
    {
        try
        {
            await _next(httpContext);
        }
        catch (Exception exception)
        {
            if (httpContext.Response.HasStarted)
            {
                throw;
            }

            await HandleExceptionAsync(httpContext, exception);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        var category = Classify(exception);
        var statusCode = category switch
        {
            ErrorCategory.Authentication => HttpStatusCode.Unauthorized,
            ErrorCategory.Validation => HttpStatusCode.BadRequest,
            ErrorCategory.NotFound => HttpStatusCode.NotFound,
            ErrorCategory.Conflict => HttpStatusCode.Conflict,
            ErrorCategory.RateLimit => HttpStatusCode.TooManyRequests,
            ErrorCategory.Timeout => HttpStatusCode.RequestTimeout,
            _ => HttpStatusCode.InternalServerError
        };

        if (category == ErrorCategory.Internal)
        {
            _logger.LogError(
                exception,
                "Unhandled API error for {Method} {Path}. TraceId={TraceId}",
                context.Request.Method,
                context.Request.Path,
                context.TraceIdentifier);
        }
        else
        {
            _logger.LogWarning(
                "Handled API error for {Method} {Path}. ErrorType={ErrorType} Detail={ErrorDetail} TraceId={TraceId}",
                context.Request.Method,
                context.Request.Path,
                exception.GetType().Name,
                exception.Message,
                context.TraceIdentifier);
        }

        if (exception is AccountTemporarilyBlockedException blockedException)
        {
            var remainingSeconds = Math.Max(
                1,
                (long)Math.Ceiling((blockedException.BlockedUntilUtc - DateTimeOffset.UtcNow).TotalSeconds));
            context.Response.Headers.RetryAfter = remainingSeconds.ToString();
        }
        else if (exception is FullImportCapacityExceededException or ImportCapacityExceededException)
        {
            context.Response.Headers.RetryAfter = "60";
        }

        context.Response.StatusCode = (int)statusCode;
        context.Response.ContentType = "application/problem+json";
        await context.Response.WriteAsJsonAsync(new
        {
            type = PublicType(category),
            title = PublicTitle(category),
            status = context.Response.StatusCode,
            detail = PublicDetail(category, exception),
            instance = context.Request.Path.Value
        });
    }

    private static ErrorCategory Classify(Exception exception)
    {
        return exception switch
        {
            AuthenticationFailedException or WrongPasswordException or UnauthorizedAccessException
                or EntityNotFoundException<User, string> => ErrorCategory.Authentication,
            ValidationException or IdentityOperationFailedException => ErrorCategory.Validation,
            AccountTemporarilyBlockedException or FullImportCapacityExceededException
                or ImportCapacityExceededException => ErrorCategory.RateLimit,
            BookImportProcessingTimeoutException => ErrorCategory.Timeout,
            EntityNotFoundException<User, Guid>
                or EntityNotFoundException<Genre, Guid>
                or EntityNotFoundException<Status, Guid>
                or EntityNotFoundException<ContentType, Guid>
                or EntityNotFoundException<Book, Guid>
                or EntityNotFoundException<BookCover, Guid>
                or EntityNotFoundException<BookFile, Guid>
                or EntityNotFoundException<BookFileJob, Guid>
                or EntityNotFoundException<BookFileDownloadTicket, Guid>
                or EntityNotFoundException<PublicBookSnapshot, Guid>
                or EntityNotFoundException<Tag, Guid>
                or EntityNotFoundException<Author, Guid> => ErrorCategory.NotFound,
            UsernameTakenException
                or EmailInUseException
                or CannotDeleteCurrentAccountException
                or EntityAlreadyExistsException<Genre, Guid>
                or EntityAlreadyExistsException<Status, Guid>
                or EntityAlreadyExistsException<ContentType, Guid>
                or EntityAlreadyExistsException<Author, Guid>
                or EntityAlreadyExistsException<Tag, Guid>
                or EntityAlreadyExistsException<Book, Guid>
                or EntityInUseException<Tag>
                or EntityInUseException<Author>
                or EntityInUseException<Genre>
                or EntityInUseException<Status>
                or EntityInUseException<ContentType> => ErrorCategory.Conflict,
            _ => ErrorCategory.Internal
        };
    }

    private static string PublicType(ErrorCategory category)
    {
        return category switch
        {
            ErrorCategory.Authentication => "AuthenticationFailed",
            ErrorCategory.Validation => "ValidationError",
            ErrorCategory.NotFound => "NotFound",
            ErrorCategory.Conflict => "Conflict",
            ErrorCategory.RateLimit => "RateLimitExceeded",
            ErrorCategory.Timeout => "RequestTimeout",
            _ => "InternalServerError"
        };
    }

    private static string PublicTitle(ErrorCategory category)
    {
        return category switch
        {
            ErrorCategory.Authentication => "Unauthorized",
            ErrorCategory.Validation => "Bad Request",
            ErrorCategory.NotFound => "Not Found",
            ErrorCategory.Conflict => "Conflict",
            ErrorCategory.RateLimit => "Too Many Requests",
            ErrorCategory.Timeout => "Request Timeout",
            _ => "Internal Server Error"
        };
    }

    private static string PublicDetail(ErrorCategory category, Exception exception)
    {
        if (exception is UsernameTakenException or EmailInUseException)
            return "Unable to create an account with these details. Try different details or sign in.";
        if (exception is AuthenticationFailedException or WrongPasswordException
            or EntityNotFoundException<User, string>)
        {
            return AuthenticationFailedException.PublicMessage;
        }

        return category switch
        {
            ErrorCategory.Authentication => "The session is invalid or has expired.",
            ErrorCategory.Validation => "The request contains invalid data.",
            ErrorCategory.NotFound => "The requested resource was not found.",
            ErrorCategory.Conflict => "The request conflicts with the current resource state.",
            ErrorCategory.RateLimit => "Too many requests. Please try again later.",
            ErrorCategory.Timeout => "The request processing time limit was exceeded.",
            _ => "An internal server error occurred."
        };
    }

    private enum ErrorCategory
    {
        Authentication,
        Validation,
        NotFound,
        Conflict,
        RateLimit,
        Timeout,
        Internal
    }
}
