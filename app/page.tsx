import Link from "next/link";

const links = [
  { href: "/sale/demo", label: "Browse a sale" },
  { href: "/seller", label: "Sell items" },
  { href: "/organizer", label: "Organize a sale" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-24">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Rummage</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          One community sale, one map, one PayPal checkout.
        </p>
      </div>
      <nav className="flex flex-col gap-3 sm:flex-row">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-full border border-zinc-300 px-5 py-3 text-center font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-zinc-500">All payments are PayPal sandbox. No real money moves.</p>
    </main>
  );
}
