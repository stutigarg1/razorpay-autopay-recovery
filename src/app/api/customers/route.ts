import { getCases } from "@/lib/store";
import { errorMessage } from "@/lib/http";

export async function GET() {
  try {
    return Response.json({ cases: await getCases() });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
