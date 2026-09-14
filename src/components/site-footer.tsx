import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-medium text-fg">Card Cutter</span> — built by
          debaters, for debaters.
        </p>
        <div className="flex gap-5">
          <Link href="/cut" className="hover:text-fg">
            Cut cards
          </Link>
          <Link href="/about" className="hover:text-fg">
            About
          </Link>
          <Link href="/pricing" className="hover:text-fg">
            Pricing
          </Link>
          <a
            href="https://logos-debate.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-fg"
            title="Search cards other people have already cut"
          >
            Logos ↗
          </a>
        </div>
      </div>
    </footer>
  );
}
