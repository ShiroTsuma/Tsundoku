namespace Infrastructure.BookFiles;

using System.Globalization;
using System.Text.RegularExpressions;

internal static class BookFileNames
{
    public static string DisplayTitle(string title, string bookTitle)
    {
        var part = title.Trim();
        if (string.Equals(part, bookTitle.Trim(), StringComparison.OrdinalIgnoreCase)) return title;
        if (part.StartsWith(bookTitle, StringComparison.OrdinalIgnoreCase))
        {
            var suffix = part[bookTitle.Length..];
            if (suffix.Length > 0 && (char.IsWhiteSpace(suffix[0]) || "-_:–—".Contains(suffix[0])))
                part = suffix.Trim().TrimStart('-', '_', ':', '–', '—').Trim();
        }

        var match = Regex.Match(part, @"^(?:(?:volume|vol\.?)\s*[-_:]?\s*)?0*(\d+)$", RegexOptions.IgnoreCase);
        return match.Success && int.TryParse(match.Groups[1].Value, out var volume)
            ? $"Volume {volume}"
            : title;
    }

    public static string DownloadName(string title, string bookTitle)
    {
        var display = DisplayTitle(title, bookTitle);
        var volume = Regex.Match(display, @"^Volume (\d+)$");
        var suffix = volume.Success ? volume.Groups[1].Value
            : string.Equals(title.Trim(), bookTitle.Trim(), StringComparison.OrdinalIgnoreCase) ? "" : Slug(title);
        return $"{Slug(bookTitle)}{(suffix.Length == 0 ? "" : $"-{suffix}")}.epub";
    }

    private static string Slug(string value)
    {
        var normalized = value.Normalize(System.Text.NormalizationForm.FormD);
        var letters = new string(normalized.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray());
        var slug = Regex.Replace(letters.ToLowerInvariant(), @"[^\p{L}\p{Nd}]+", "-").Trim('-');
        slug = slug[..Math.Min(slug.Length, 120)].TrimEnd('-');
        return slug.Length == 0 ? "book" : slug;
    }
}
