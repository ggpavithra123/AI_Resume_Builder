import { hc } from "hono/client";
import { AppType } from "@/app/api/[[...route]]/route";

export const client = hc<AppType>("https://ai-resume-builder-xnok.vercel.app");

export const api = client.api;
