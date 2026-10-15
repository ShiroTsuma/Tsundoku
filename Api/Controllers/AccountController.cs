namespace Api.Controllers;

using Application.Features.AccountFeatures.Commands;
using Application.Features.AccountFeatures;
using Application.Common.DTOs.User;
using Application.Common.Models;
using Domain.Exceptions;
using FluentValidation;

[ApiController]
[Route(ApiRoutes.Account)]
public class AccountController : ControllerBase
{
    internal const string RefreshTokenCookieName = "__Host-tsundoku.refresh";

    private readonly ILogger<AccountController> _logger;
    private readonly IMediator _mediator;

    public AccountController(IMediator mediator, ILogger<AccountController> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterUserCommand registerUserCommand)
    {
        var response = await _mediator.Send(registerUserCommand);
        _logger.LogInformation("User registered. UserId={UserId} Username={Username}", response.Id,
            registerUserCommand.Username);
        return Ok(response);
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginUserCommand loginUserCommand)
    {
        TokenResponse response;
        try
        {
            response = await _mediator.Send(loginUserCommand);
        }
        catch (ValidationException)
        {
            throw new AuthenticationFailedException();
        }

        SetRefreshTokenCookie(response);
        _logger.LogInformation(
            "User logged in. UserId={UserId} IdentifierType={IdentifierType}",
            response.UserId,
            string.IsNullOrWhiteSpace(loginUserCommand.Username) ? "Email" : "Username");
        return Ok(response);
    }

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh()
    {
        var refreshToken = Request.Cookies[RefreshTokenCookieName] ?? string.Empty;
        var refreshTokenCommand = new RefreshTokenCommand(refreshToken);
        var response = await _mediator.Send(refreshTokenCommand);
        SetRefreshTokenCookie(response);
        _logger.LogInformation("Access token refreshed. UserId={UserId}", response.UserId);
        return Ok(response);
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        var refreshToken = Request.Cookies[RefreshTokenCookieName];
        var logoutCommand = new LogoutCommand(refreshToken);
        await _mediator.Send(logoutCommand);
        Response.Cookies.Delete(RefreshTokenCookieName, CreateRefreshTokenCookieOptions());
        return NoContent();
    }

    [HttpGet("reading-time-settings")]
    [Authorize]
    public async Task<IActionResult> GetReadingTimeSettings()
    {
        return Ok(await _mediator.Send(new GetReadingTimeSettingsQuery()));
    }

    [HttpPut("reading-time-settings")]
    [Authorize]
    public async Task<IActionResult> UpdateReadingTimeSettings([FromBody] UpdateReadingTimeSettingsRequest request)
    {
        return Ok(await _mediator.Send(new UpdateReadingTimeSettingsCommand(request.Settings ?? [])));
    }

    private void SetRefreshTokenCookie(TokenResponse response)
    {
        var options = CreateRefreshTokenCookieOptions();
        options.Expires = response.RefreshTokenExpiresAt;
        Response.Cookies.Append(RefreshTokenCookieName, response.RefreshToken, options);
    }

    private static CookieOptions CreateRefreshTokenCookieOptions()
    {
        return new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            IsEssential = true
        };
    }
}
