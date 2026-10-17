using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCrawlerIntegration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BookCrawlerSources",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    BookId = table.Column<Guid>(type: "uuid", nullable: false),
                    Url = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    SourceName = table.Column<string>(type: "text", nullable: false),
                    Selected = table.Column<bool>(type: "boolean", nullable: false),
                    Tracked = table.Column<bool>(type: "boolean", nullable: false),
                    NextScanAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastScannedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "text", nullable: true),
                    ChaptersJson = table.Column<string>(type: "text", nullable: false),
                    DownloadedUrlsJson = table.Column<string>(type: "text", nullable: false),
                    DownloadBoundaryUrl = table.Column<string>(type: "text", nullable: true),
                    NewSinceDownload = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookCrawlerSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookCrawlerSources_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CrawlerJobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    BookId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    RequestKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    RequestJson = table.Column<string>(type: "text", nullable: false),
                    ResultJson = table.Column<string>(type: "text", nullable: false),
                    Error = table.Column<string>(type: "text", nullable: true),
                    CancelRequested = table.Column<bool>(type: "boolean", nullable: false),
                    Submitted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseUntilUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ExpiresAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CrawlerJobs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CrawlerJobs_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookCrawlerSources_BookId_Url",
                table: "BookCrawlerSources",
                columns: new[] { "BookId", "Url" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookCrawlerSources_Tracked_NextScanAtUtc",
                table: "BookCrawlerSources",
                columns: new[] { "Tracked", "NextScanAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CrawlerJobs_BookId",
                table: "CrawlerJobs",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_CrawlerJobs_OwnerId_Kind_RequestKey",
                table: "CrawlerJobs",
                columns: new[] { "OwnerId", "Kind", "RequestKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CrawlerJobs_Status_NextAttemptAtUtc",
                table: "CrawlerJobs",
                columns: new[] { "Status", "NextAttemptAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookCrawlerSources");

            migrationBuilder.DropTable(
                name: "CrawlerJobs");
        }
    }
}
