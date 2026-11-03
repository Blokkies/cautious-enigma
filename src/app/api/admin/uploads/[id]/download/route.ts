import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/api-auth";
import { attachmentContentDisposition } from "@/lib/content-disposition";
import { parseId } from "@/lib/ids";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request, { roles: ["admin"] });
  if (auth.response) return auth.response;

  try {
    const id = parseId((await params).id);
    if (id === null) {
      return NextResponse.json({ error: "Invalid upload id" }, { status: 400 });
    }
    const [upload] = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, id));

    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    // Decode base64 back to binary
    const fileBuffer = Buffer.from(upload.fileData, "base64");

    // Only a plain "type/subtype" from the stored row; anything odd is served as opaque bytes.
    const contentType = !upload.mimeType
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : /^[\w.+-]+\/[\w.+-]+$/.test(upload.mimeType)
        ? upload.mimeType
        : "application/octet-stream";

    const contentDisposition = attachmentContentDisposition(upload.filename || "upload.xlsx");

    return new NextResponse(fileBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
        "Content-Length": String(fileBuffer.length),
        // The stored mime type came from the uploader: never let a browser
        // sniff the bytes into something renderable (e.g. HTML).
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error downloading upload:", error);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}
