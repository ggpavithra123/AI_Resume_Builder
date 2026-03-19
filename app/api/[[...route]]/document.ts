import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import {
  createDocumentTableSchema,
  DocumentSchema,
  documentTable,
  updateCombinedSchema,
  UpdateDocumentSchema,
} from "@/db/schema/document";

import { getAuthUser } from "@/lib/kinde";
import { generateDocUUID } from "@/lib/helper";
import { db } from "@/db";

import {
  educationTable,
  experienceTable,
  personalInfoTable,
  skillsTable,
} from "@/db/schema";

const documentRoute = new Hono();

/* ======================================================
   CREATE DOCUMENT
====================================================== */
documentRoute.post(
  "/create",
  zValidator("json", createDocumentTableSchema),
  getAuthUser,
  async (c) => {
    try {
      const user = c.get("user");
      if (!user) {
        return c.json({ success: false, message: "Unauthorized" }, 401);
      }

      const { title } = c.req.valid("json") as DocumentSchema;

      const newDoc = {
        title,
        userId: user.id,
        documentId: generateDocUUID(),
        authorName: `${user.given_name} ${user.family_name || ""}`,
        authorEmail: user.email as string,
      };

      const [data] = await db.insert(documentTable).values(newDoc).returning();

      return c.json({ success: true, data }, 200);
    } catch (error: any) {
      console.error("CREATE ERROR:", error);
      return c.json(
        {
          success: false,
          message: "Failed to create document",
          error: error?.message || error,
        },
        500
      );
    }
  }
);

/* ======================================================
   UPDATE DOCUMENT
====================================================== */
documentRoute.patch(
  "/update/:documentId",
  zValidator("param", z.object({ documentId: z.string() })),
  zValidator("json", updateCombinedSchema),
  getAuthUser,
  async (c) => {
    try {
      const user = c.get("user");
      if (!user) {
        return c.json({ success: false, message: "Unauthorized" }, 401);
      }

      const { documentId } = c.req.valid("param");
      const userId = user.id;

      const {
        title,
        status,
        summary,
        thumbnail,
        themeColor,
        currentPosition,
        personalInfo,
        experience,
        education,
        skills,
      } = c.req.valid("json");

      await db.transaction(async (trx) => {
        const [existingDocument] = await trx
          .select()
          .from(documentTable)
          .where(
            and(
              eq(documentTable.documentId, documentId),
              eq(documentTable.userId, userId)
            )
          );

        if (!existingDocument) {
          throw new Error("Document not found");
        }

        /* ---------- UPDATE MAIN DOCUMENT ---------- */
        const updateData: Partial<UpdateDocumentSchema> = {};

        if (title) updateData.title = title;
        if (thumbnail) updateData.thumbnail = thumbnail;
        if (summary) updateData.summary = summary;
        if (themeColor) updateData.themeColor = themeColor;
        if (status) updateData.status = status;
        if (currentPosition) updateData.currentPosition = currentPosition;

        if (Object.keys(updateData).length > 0) {
          await trx
            .update(documentTable)
            .set(updateData)
            .where(eq(documentTable.documentId, documentId));
        }

        /* ---------- PERSONAL INFO ---------- */
        if (personalInfo) {
          const exists = await trx
            .select()
            .from(personalInfoTable)
            .where(eq(personalInfoTable.docId, existingDocument.id));

          if (exists.length > 0) {
            await trx
              .update(personalInfoTable)
              .set(personalInfo)
              .where(eq(personalInfoTable.docId, existingDocument.id));
          } else {
            await trx.insert(personalInfoTable).values({
              docId: existingDocument.id,
              ...personalInfo,
            });
          }
        }

        /* ---------- EXPERIENCE ---------- */
        if (Array.isArray(experience)) {
          for (const exp of experience) {
            const { id, ...data } = exp;

            if (id) {
              await trx
                .update(experienceTable)
                .set(data)
                .where(eq(experienceTable.id, id));
            } else {
              await trx.insert(experienceTable).values({
                docId: existingDocument.id,
                ...data,
              });
            }
          }
        }

        /* ---------- EDUCATION ---------- */
        if (Array.isArray(education)) {
          for (const edu of education) {
            const { id, ...data } = edu;

            if (id) {
              await trx
                .update(educationTable)
                .set(data)
                .where(eq(educationTable.id, id));
            } else {
              await trx.insert(educationTable).values({
                docId: existingDocument.id,
                ...data,
              });
            }
          }
        }

        /* ---------- SKILLS ---------- */
        if (Array.isArray(skills)) {
          for (const skill of skills) {
            const { id, ...data } = skill;

            if (id) {
              await trx
                .update(skillsTable)
                .set(data)
                .where(eq(skillsTable.id, id));
            } else {
              await trx.insert(skillsTable).values({
                docId: existingDocument.id,
                ...data,
              });
            }
          }
        }
      });

      return c.json({ success: true, message: "Updated successfully" }, 200);
    } catch (error: any) {
      console.error("UPDATE ERROR:", error);
      return c.json(
        {
          success: false,
          message: "Failed to update document",
          error: error?.message || error,
        },
        500
      );
    }
  }
);

/* ======================================================
   RESTORE DOCUMENT
====================================================== */
documentRoute.patch(
  "/restore/archive",
  zValidator(
    "json",
    z.object({
      documentId: z.string(),
      status: z.string(),
    })
  ),
  getAuthUser,
  async (c) => {
    try {
      const user = c.get("user");
      if (!user) return c.json({ message: "Unauthorized" }, 401);

      const { documentId, status } = c.req.valid("json");

      if (status !== "archived") {
        return c.json({ message: "Invalid status" }, 400);
      }

      const [doc] = await db
        .update(documentTable)
        .set({ status: "private" })
        .where(eq(documentTable.documentId, documentId))
        .returning();

      if (!doc) {
        return c.json({ message: "Document not found" }, 404);
      }

      return c.json({ success: true, data: doc });
    } catch (error: any) {
      console.error("RESTORE ERROR:", error);
      return c.json(
        {
          success: false,
          message: "Failed to restore document",
          error: error?.message || error,
        },
        500
      );
    }
  }
);

/* ======================================================
   GET ALL DOCUMENTS
====================================================== */
documentRoute.get("/all", getAuthUser, async (c) => {
  try {
    const user = c.get("user");

    console.log("🔥 USER:", user);

    if (!user || !user.id) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    const documents = await db
      .select()
      .from(documentTable)
      .where(eq(documentTable.userId, user.id));

    console.log("📄 DOCUMENTS:", documents);

    return c.json({ success: true, data: documents });

  } catch (error: any) {
    console.error("❌ FETCH ALL ERROR FULL:", error);

    return c.json(
      {
        success: false,
        message: "Failed to fetch documents",
        error: error?.message || error,
      },
      500
    );
  }
});

/* ======================================================
   GET SINGLE DOCUMENT
====================================================== */
documentRoute.get(
  "/:documentId",
  zValidator("param", z.object({ documentId: z.string() })),
  getAuthUser,
  async (c) => {
    try {
      const user = c.get("user");
      if (!user) return c.json({ message: "Unauthorized" }, 401);

      const { documentId } = c.req.valid("param");

      const doc = await db.query.documentTable.findFirst({
        where: and(
          eq(documentTable.userId, user.id),
          eq(documentTable.documentId, documentId)
        ),
        with: {
          personalInfo: true,
          experiences: true,
          educations: true,
          skills: true,
        },
      });

      return c.json({ success: true, data: doc });
    } catch (error: any) {
      console.error("FETCH ONE ERROR:", error);
      return c.json(
        {
          success: false,
          message: "Failed to fetch document",
          error: error?.message || error,
        },
        500
      );
    }
  }
);

/* ======================================================
   PUBLIC DOCUMENT
====================================================== */
documentRoute.get(
  "/public/doc/:documentId",
  zValidator("param", z.object({ documentId: z.string() })),
  async (c) => {
    try {
      const { documentId } = c.req.valid("param");

      const doc = await db.query.documentTable.findFirst({
        where: and(
          eq(documentTable.status, "public"),
          eq(documentTable.documentId, documentId)
        ),
      });

      if (!doc) {
        return c.json({ message: "Unauthorized" }, 401);
      }

      return c.json({ success: true, data: doc });
    } catch (error: any) {
      console.error("PUBLIC ERROR:", error);
      return c.json(
        {
          success: false,
          message: "Failed to fetch document",
          error: error?.message || error,
        },
        500
      );
    }
  }
);

/* ======================================================
   TRASH DOCUMENTS
====================================================== */
documentRoute.get("/trash/all", getAuthUser, async (c) => {
  try {
    const user = c.get("user");
    if (!user) return c.json({ message: "Unauthorized" }, 401);

    const docs = await db
      .select()
      .from(documentTable)
      .where(
        and(
          eq(documentTable.userId, user.id),
          eq(documentTable.status, "archived")
        )
      );

    return c.json({ success: true, data: docs });
  } catch (error: any) {
    console.error("TRASH ERROR:", error);
    return c.json(
      {
        success: false,
        message: "Failed to fetch documents",
        error: error?.message || error,
      },
      500
    );
  }
});

export default documentRoute;