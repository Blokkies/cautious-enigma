import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/api-auth";
import { attachmentContentDisposition } from "@/lib/content-disposition";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request, { roles: ["admin"] });
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const [upload] = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, Number(id)));

    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    // Decode base64 back to binary
    const fileBuffer = Buffer.from(upload.fileData, "base64");

    const contentType =
      upload.mimeType ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const contentDisposition = attachmentContentDisposition(upload.filename || "upload.xlsx");

    return new NextResponse(fileBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
        "Content-Length": String(fileBuffer.length),
      },
    });
  } catch (error) {
    console.error("Error downloading upload:", error);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}
