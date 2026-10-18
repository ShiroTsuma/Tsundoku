using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMetadataPolicies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MetadataAlias",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceKind = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    TagId = table.Column<Guid>(type: "uuid", nullable: true),
                    GenreId = table.Column<Guid>(type: "uuid", nullable: true),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    LastModified = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastModifiedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MetadataAlias", x => x.Id);
                    table.CheckConstraint("CK_MetadataAlias_Kind", "\"SourceKind\" IN ('tag', 'genre')");
                    table.CheckConstraint("CK_MetadataAlias_Target", "(\"TagId\" IS NULL) <> (\"GenreId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_MetadataAlias_Genres_GenreId",
                        column: x => x.GenreId,
                        principalTable: "Genres",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MetadataAlias_Tags_TagId",
                        column: x => x.TagId,
                        principalTable: "Tags",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MetadataImplication",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceTagId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceGenreId = table.Column<Guid>(type: "uuid", nullable: true),
                    TargetTagId = table.Column<Guid>(type: "uuid", nullable: true),
                    TargetGenreId = table.Column<Guid>(type: "uuid", nullable: true),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    LastModified = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastModifiedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MetadataImplication", x => x.Id);
                    table.CheckConstraint("CK_MetadataImplication_Source", "(\"SourceTagId\" IS NULL) <> (\"SourceGenreId\" IS NULL)");
                    table.CheckConstraint("CK_MetadataImplication_Target", "(\"TargetTagId\" IS NULL) <> (\"TargetGenreId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_MetadataImplication_Genres_SourceGenreId",
                        column: x => x.SourceGenreId,
                        principalTable: "Genres",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MetadataImplication_Genres_TargetGenreId",
                        column: x => x.TargetGenreId,
                        principalTable: "Genres",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MetadataImplication_Tags_SourceTagId",
                        column: x => x.SourceTagId,
                        principalTable: "Tags",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MetadataImplication_Tags_TargetTagId",
                        column: x => x.TargetTagId,
                        principalTable: "Tags",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MetadataAlias_GenreId",
                table: "MetadataAlias",
                column: "GenreId");

            migrationBuilder.CreateIndex(
                name: "IX_MetadataAlias_SourceKind_NormalizedName",
                table: "MetadataAlias",
                columns: new[] { "SourceKind", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MetadataAlias_TagId",
                table: "MetadataAlias",
                column: "TagId");

            migrationBuilder.CreateIndex(
                name: "IX_MetadataImplication_SourceGenreId",
                table: "MetadataImplication",
                column: "SourceGenreId");

            migrationBuilder.CreateIndex(
                name: "IX_MetadataImplication_SourceTagId",
                table: "MetadataImplication",
                column: "SourceTagId");

            migrationBuilder.CreateIndex(
                name: "IX_MetadataImplication_TargetGenreId",
                table: "MetadataImplication",
                column: "TargetGenreId");

            migrationBuilder.CreateIndex(
                name: "IX_MetadataImplication_TargetTagId",
                table: "MetadataImplication",
                column: "TargetTagId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MetadataAlias");

            migrationBuilder.DropTable(
                name: "MetadataImplication");
        }
    }
}
