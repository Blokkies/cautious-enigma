import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { uploads, stocktakeEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

// GET: List all uploads with linked events
export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    // Get all uploads (without file_data to keep response small)
    const allUploads = await db
      .select({
        id: uploads.id,
        filename: uploads.filename,
        fileSize: uploads.fileSize,
        mimeType: uploads.mimeType,
        uploadedBy: uploads.uploadedBy,
        createdAt: uploads.createdAt,
      })
      .from(uploads)
      .orderBy(uploads.createdAt);

    // For each upload, find linked events
    const result = await Promise.all(
      allUploads.map(async (upload) => {
        const linkedEvents = await db
          .select({
            id: stocktakeEvents.id,
            name: stocktakeEvents.name,
            status: stocktakeEvents.status,
          })
          .from(stocktakeEvents)
          .where(eq(stocktakeEvents.uploadId, upload.id));

        return { ...upload, linkedEvents };
      })
    );

    return NextResponse.json({ uploads: result });
  } catch (error) {
    console.error("Error listing uploads:", error);
    return NextResponse.json({ error: "Failed to list uploads" }, { status: 500 });
  }
}

// DELETE: Delete an upload by id (only if no events reference it)
export async function DELETE(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Upload id required" }, { status: 400 });
    }

    // Check if any events reference this upload
    const linkedEvents = await db
      .select({ id: stocktakeEvents.id, name: stocktakeEvents.name })
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.uploadId, Number(id)));

    if (linkedEvents.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete: file is still linked to events",
          linkedEvents: linkedEvents.map((e) => e.name),
        },
        { status: 409 }
      );
    }

    // Safe to delete
    await db.delete(uploads).where(eq(uploads.id, Number(id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting upload:", error);
    return NextResponse.json({ error: "Failed to delete upload" }, { status: 500 });
  }
}
