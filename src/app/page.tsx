import { getConfig } from "@/lib/config";
import { getDbStats } from "@/lib/db";

// Force dynamic rendering to prevent build-time DB access and allow env vars
export const dynamic = "force-dynamic";

export default async function Home() {
  const config = getConfig();
  const stats = getDbStats();

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {config.appName}
          </h1>
          <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
            Self-hosted media gallery — your folder tree is the source of truth.
          </p>
        </div>

        {/* Configuration */}
        <section className="mb-12">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Configuration
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <dl className="divide-y divide-zinc-200 dark:divide-zinc-800">
              <div className="grid grid-cols-3 gap-4 px-4 py-3">
                <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Media Root
                </dt>
                <dd className="col-span-2 text-sm font-mono text-zinc-900 dark:text-zinc-100">
                  {config.mediaRoot}
                </dd>
              </div>
              <div className="grid grid-cols-3 gap-4 px-4 py-3">
                <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Data Root
                </dt>
                <dd className="col-span-2 text-sm font-mono text-zinc-900 dark:text-zinc-100">
                  {config.dataRoot}
                </dd>
              </div>
              <div className="grid grid-cols-3 gap-4 px-4 py-3">
                <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Thumbnail Root
                </dt>
                <dd className="col-span-2 text-sm font-mono text-zinc-900 dark:text-zinc-100">
                  {config.thumbRoot}
                </dd>
              </div>
              <div className="grid grid-cols-3 gap-4 px-4 py-3">
                <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Database
                </dt>
                <dd className="col-span-2 text-sm font-mono text-zinc-900 dark:text-zinc-100">
                  {config.dbPath}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Database Stats */}
        <section className="mb-12">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Database Counts
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900">
              <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Folders
              </dt>
              <dd className="mt-1 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
                {stats.folderCount}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900">
              <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Media
              </dt>
              <dd className="mt-1 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
                {stats.mediaCount}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900">
              <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Tags
              </dt>
              <dd className="mt-1 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
                {stats.tagCount}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900">
              <dt className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Scan Jobs
              </dt>
              <dd className="mt-1 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
                {stats.scanJobCount}
              </dd>
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Coming Next
          </h2>
          <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <ul className="space-y-3 text-zinc-700 dark:text-zinc-300">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                <span>Folder scanning — traverse the media tree and index files</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                <span>Thumbnail generation — pre-render previews with Sharp</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                <span>Media gallery view — browse indexed GIFs and videos</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                <span>Tagging system — organize media with custom tags</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
