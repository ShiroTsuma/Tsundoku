namespace Application.UnitTests;

using System.Text.Json;
using Domain.Entities;
using Domain.Exceptions;
using FluentValidation;
using Infrastructure.Identity;
using Infrastructure.Middleware;
using Infrastructure.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Moq;

public class ErrorHandlingMiddlewareTests
{
    public static TheoryData<Exception, int, string, string> MappedExceptions => new()
    {
        {
            new AuthenticationFailedException(), StatusCodes.Status401Unauthorized, "Unauthorized",
            "AuthenticationFailed"
        },
        {
            new EntityNotFoundException<User, string>("missing"), StatusCodes.Status401Unauthorized, "Unauthorized",
            "AuthenticationFailed"
        },
        {
            new EntityNotFoundException<User, Guid>(Guid.NewGuid()), StatusCodes.Status404NotFound, "Not Found",
            "NotFound"
        },
        {
            new EntityAlreadyExistsException<Genre, Guid>("Fantasy", Guid.NewGuid()), StatusCodes.Status409Conflict,
            "Conflict", "Conflict"
        },
        {
            new EntityNotFoundException<Book, Guid>(Guid.NewGuid()), StatusCodes.Status404NotFound, "Not Found",
            "NotFound"
        },
        { new EntityInUseException<Tag>("favorite"), StatusCodes.Status409Conflict, "Conflict", "Conflict" },
        {
            new FullImportCapacityExceededException("Full import capacity reached."),
            StatusCodes.Status429TooManyRequests, "Too Many Requests", "RateLimitExceeded"
        },
        {
            new BookImportProcessingTimeoutException("Full import timed out."), StatusCodes.Status408RequestTimeout,
            "Request Timeout", "RequestTimeout"
        },
        {
            new InvalidOperationException("secret implementation detail"), StatusCodes.Status500InternalServerError,
            "Internal Server Error", "InternalServerError"
        }
    };

    [Fact]
    public async Task InvokeAsync_ShouldCallNextWhenNoExceptionIsThrown()
    {
        var called = false;
        var context = new DefaultHttpContext();
        var middleware = new ErrorHandlingMiddleware(
            _ =>
            {
                called = true;
                return Task.CompletedTask;
            },
            Mock.Of<ILogger<ErrorHandlingMiddleware>>());

        await middleware.InvokeAsync(context);

        Assert.True(called);
        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(MappedExceptions))]
    public async Task InvokeAsync_ShouldMapKnownExceptionsWithoutExposingExceptionDetails(
        Exception exception,
        int expectedStatus,
        string expectedTitle,
        string expectedType)
    {
        var context = await InvokeWithException(exception);

        context.Response.Body.Position = 0;
        using var document = await JsonDocument.ParseAsync(context.Response.Body);
        var root = document.RootElement;

        Assert.Equal(expectedStatus, context.Response.StatusCode);
        Assert.Equal(expectedTitle, root.GetProperty("title").GetString());
        Assert.Equal(expectedType, root.GetProperty("type").GetString());
        Assert.Equal(expectedStatus, root.GetProperty("status").GetInt32());
        Assert.DoesNotContain(exception.GetType().Name, root.GetRawText());
        if (exception is not AuthenticationFailedException and not EntityNotFoundException<User, string>)
        {
            Assert.DoesNotContain(exception.Message, root.GetRawText());
        }
    }

    [Fact]
    public async Task InvokeAsync_ShouldUseUniformPublicLoginFailure()
    {
        var missingUser = await InvokeWithException(new EntityNotFoundException<User, string>("reader"));
        var wrongPassword = await InvokeWithException(new WrongPasswordException());

        Assert.Equal(StatusCodes.Status401Unauthorized, missingUser.Response.StatusCode);
        Assert.Equal(StatusCodes.Status401Unauthorized, wrongPassword.Response.StatusCode);
        Assert.Equal(
            await ReadDetailAsync(missingUser),
            await ReadDetailAsync(wrongPassword));
        Assert.Equal(AuthenticationFailedException.PublicMessage, await ReadDetailAsync(missingUser));
    }

    [Fact]
    public async Task InvokeAsync_ShouldKeepValidationDetailOnlyInLogs()
    {
        const string sensitiveDetail = "Full backup is missing manifest.json.";
        var logger = new Mock<ILogger<ErrorHandlingMiddleware>>();
        var context = new DefaultHttpContext();
        context.Request.Method = HttpMethods.Post;
        context.Request.Path = "/api/v1/book/import/full/sessions";
        context.Response.Body = new MemoryStream();
        var middleware = new ErrorHandlingMiddleware(
            _ => throw new ValidationException(sensitiveDetail),
            logger.Object);

        await middleware.InvokeAsync(context);

        context.Response.Body.Position = 0;
        using var document = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal(StatusCodes.Status400BadRequest, context.Response.StatusCode);
        Assert.DoesNotContain(sensitiveDetail, document.RootElement.GetRawText());
        logger.Verify(
            candidate => candidate.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((state, _) =>
                    state.ToString()!.Contains(sensitiveDetail) &&
                    state.ToString()!.Contains("/api/v1/book/import/full/sessions")),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Fact]
    public async Task InvokeAsync_ShouldReturnRemainingBlockInRetryAfterHeader()
    {
        var context = await InvokeWithException(
            new AccountTemporarilyBlockedException(DateTimeOffset.UtcNow.AddHours(24)));

        Assert.Equal(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
        Assert.True(long.TryParse(context.Response.Headers.RetryAfter, out var retryAfter));
        Assert.InRange(retryAfter, 23 * 60 * 60, 24 * 60 * 60);
    }

    [Theory]
    [InlineData("reader", null)]
    [InlineData(null, "reader@example.com")]
    public async Task InvokeAsync_ShouldNotExposeAccountConflictIdentifier(string? username, string? email)
    {
        Exception exception = username != null
            ? new UsernameTakenException(username)
            : new EmailInUseException(email!);
        var context = await InvokeWithException(exception);

        context.Response.Body.Position = 0;
        using var document = await JsonDocument.ParseAsync(context.Response.Body);
        var response = document.RootElement.GetRawText();

        Assert.Equal(StatusCodes.Status409Conflict, context.Response.StatusCode);
        Assert.DoesNotContain(username ?? email!, response);
        Assert.DoesNotContain(exception.GetType().Name, response);
        var detail = document.RootElement.GetProperty("detail").GetString();
        Assert.Equal("Unable to create an account with these details. Try different details or sign in.", detail);
        Assert.False(document.RootElement.TryGetProperty("errors", out _));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InvokeAsync_LogsStackOnlyForUnexpectedFailures(bool unexpected)
    {
        var exception = unexpected ? (Exception)new InvalidOperationException("Internal failure") : new UsernameTakenException("reader");
        var logger = new Mock<ILogger<ErrorHandlingMiddleware>>();
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        await new ErrorHandlingMiddleware(_ => throw exception, logger.Object).InvokeAsync(context);
        logger.Verify(candidate => candidate.Log(
            unexpected ? LogLevel.Error : LogLevel.Warning,
            It.IsAny<EventId>(),
            It.IsAny<It.IsAnyType>(),
            unexpected ? exception : null,
            It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
    }

    private static async Task<string?> ReadDetailAsync(DefaultHttpContext context)
    {
        context.Response.Body.Position = 0;
        using var document = await JsonDocument.ParseAsync(context.Response.Body);
        return document.RootElement.GetProperty("detail").GetString();
    }

    private static async Task<DefaultHttpContext> InvokeWithException(Exception exception)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/test";
        context.Response.Body = new MemoryStream();
        var middleware = new ErrorHandlingMiddleware(
            _ => throw exception,
            Mock.Of<ILogger<ErrorHandlingMiddleware>>());

        await middleware.InvokeAsync(context);
        return context;
    }
}
