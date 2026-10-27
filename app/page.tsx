import { NavIcon } from "@/components/nav-icon";
import type { NavIcon as NavIconName } from "@/components/nav";
import { ButtonLink, Card, CardTitle, PageContainer } from "@/components/ui";

const steps: Array<{ icon: NavIconName; title: string; body: string }> = [
  {
    icon: "sell",
    title: "Sell",
    body: "Snap a photo. We draft the title, category and price. You check it and list it.",
  },
  {
    icon: "browse",
    title: "Shop",
    body: "See every driveway on one map. Hold what you like, then pay everyone at once.",
  },
  {
    icon: "organize",
    title: "Organize",
    body: "Set the date and the streets, invite households, and raise a little for the school.",
  },
];

export default function Home() {
  return (
    <PageContainer className="flex flex-col justify-center gap-5 py-5 md:gap-8 md:py-12">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-accent-strong">Community yard sales</p>
        <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance md:text-5xl">
          The whole street&rsquo;s yard sale, in one place.
        </h1>
        <p className="text-base text-ink-soft md:text-lg">
          One map, one checkout, a pickup code for every find.
        </p>
      </div>

      <ol className="grid gap-2.5 md:grid-cols-3 md:gap-4">
        {steps.map((step) => (
          <li key={step.title}>
            <Card padding="sm" className="flex h-full items-start gap-3 md:flex-col md:p-4">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent-strong"
              >
                <NavIcon name={step.icon} className="size-5" />
              </span>
              <div className="flex flex-col gap-0.5">
                <CardTitle as="h2" className="text-base md:text-lg">
                  {step.title}
                </CardTitle>
                <p className="text-sm leading-snug text-ink-soft">{step.body}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <div className="flex gap-2.5">
        <ButtonLink href="/sale/demo" size="lg" className="flex-1 sm:flex-none">
          See the demo sale
        </ButtonLink>
        <ButtonLink href="/sign-in" variant="secondary" size="lg">
          Sign in
        </ButtonLink>
      </div>

      <p className="text-xs text-ink-faint">Demo data only. Payments run in test mode, so no real money moves.</p>
    </PageContainer>
  );
}
