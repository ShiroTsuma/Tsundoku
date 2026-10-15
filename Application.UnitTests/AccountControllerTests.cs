using Api.Controllers;
using Application.Common.DTOs.User;
using Application.Common.Models;
using Application.Features.AccountFeatures.Commands;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using System.Text.Json;

namespace Application.UnitTests;

public class AccountControllerTests
{
    [Fact]
    public async Task AccountActions_ShouldForwardCommandsToMediator()
    {
        var userId = Guid.NewGuid();
        var registerCommand =
            new RegisterUserCommand { Username = "reader", Email = "reader@example.com", Password = "Strong1!" };
        var loginCommand = new LoginUserCommand { Username = "reader", Password = "Strong1!" };
        var refreshCommand = new RefreshTokenCommand("refresh");
        var logoutCommand = new LogoutCommand("refresh");
        var registerResponse = new RegisterResponse { Id = userId, Name = "reader" };
        var tokenResponse = new TokenResponse
        {
            AccessToken = "jwt",
            RefreshToken = "refresh",
            RefreshTokenExpiresAt = DateTimeOffset.Parse("2026-08-01T10:00:00Z"),
            UserId = userId
        };
        var mediator = new Mock<IMediator>();
        mediator.Setup(mock => mock.Send(registerCommand, It.IsAny<CancellationToken>()))
            .ReturnsAsync(registerResponse);
        mediator.Setup(mock => mock.Send(loginCommand, It.IsAny<CancellationToken>())).ReturnsAsync(tokenResponse);
        mediator.Setup(mock => mock.Send(refreshCommand, It.IsAny<CancellationToken>())).ReturnsAsync(tokenResponse);
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers.Cookie = "__Host-tsundoku.refresh=refresh";
        var controller = new AccountController(mediator.Object, NullLogger<AccountController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = httpContext }
        };

        Assert.Same(registerResponse, Assert.IsType<OkObjectResult>(await controller.Register(registerCommand)).Value);
        Assert.Same(tokenResponse, Assert.IsType<OkObjectResult>(await controller.Login(loginCommand)).Value);
        Assert.Same(tokenResponse, Assert.IsType<OkObjectResult>(await controller.Refresh()).Value);
        Assert.IsType<NoContentResult>(await controller.Logout());
        mediator.Verify(mock => mock.Send(logoutCommand, It.IsAny<CancellationToken>()), Times.Once);
        Assert.Contains(httpContext.Response.Headers.SetCookie,
            value => value != null &&
                     value.Contains("HttpOnly", StringComparison.OrdinalIgnoreCase) &&
                     value.Contains("Secure", StringComparison.OrdinalIgnoreCase) &&
                     value.Contains("SameSite=Strict", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(
            "\"refreshToken\":",
            JsonSerializer.Serialize(tokenResponse),
            StringComparison.OrdinalIgnoreCase);
    }
}
