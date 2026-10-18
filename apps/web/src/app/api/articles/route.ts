import { NextResponse } from "next/server";
import { z } from "zod";
import { createArticle, listArticles } from "@/lib/articles/queries";

const createSchema = z.object({
  source: z.string().min(1).default("X/Twitter (pasted)"),
  url: z.string().url().optional(),
  title: z.string().min(1),
  body_md: z.string().min(20),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  return NextResponse.json(listArticles());
}

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const id = createArticle(parsed.data);
  return NextResponse.json({ id });
}
