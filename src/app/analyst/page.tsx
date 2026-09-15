import { isAiConfigured } from "@/lib/ai/client";
import { buildSnapshot } from "@/lib/analytics";
import { Card } from "@/components/ui";
import { AnalystChat } from "./chat";

export const dynamic = "force-dynamic";

export default function AnalystPage() {
  const snapshot = buildSnapshot(30);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Ask the analyst</h1>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          Questions about your own numbers. Claude gets the account summary up front and can pull
          campaign-level detail and the attribution breakdown on demand.
        </p>
      </div>

      <Card>
        <AnalystChat
          aiConfigured={isAiConfigured()}
          hasData={!snapshot.isEmpty}
          suggestions={[
            "Which campaign is wasting the most money, and how sure are you?",
            "Is Meta really outperforming Google, or is that an attribution artefact?",
            "If I had another $5,000 a month, where should it go?",
            "How much of my revenue can you actually trace to an ad?",
          ]}
        />
      </Card>
    </div>
  );
}
