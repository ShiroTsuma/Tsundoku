using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddLibraryCrawlerDiscovery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BookCrawlerDiscoveries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    BookId = table.Column<Guid>(type: "uuid", nullable: false),
                    LastCheckedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NextCheckAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResultJson = table.Column<string>(type: "text", nullable: false),
                    LastError = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookCrawlerDiscoveries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookCrawlerDiscoveries_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BookCrawlerDiscoveries_BookId",
                table: "BookCrawlerDiscoveries",
                column: "BookId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookCrawlerDiscoveries_NextCheckAtUtc",
                table: "BookCrawlerDiscoveries",
                column: "NextCheckAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookCrawlerDiscoveries");
        }
    }
}
