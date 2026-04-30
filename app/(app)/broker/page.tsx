/**
 * broker — stub. Real implementation lands when this section is migrated.
 * For now this just confirms the SPA navigation works end-to-end.
 */
export default function BrokerPage() {
  return (
    <div className="px-8 py-10 max-w-6xl">
      <h1 className="text-2xl font-bold mb-1 capitalize">broker</h1>
      <p className="text-sm text-zinc-500 mb-8">
        Coming soon. The current broker experience still lives at{' '}
        <a href="https://staxs.ai/client-dashboard.html" className="text-amber-400 underline">
          staxs.ai/client-dashboard.html
        </a>{' '}
        — this section will be migrated here once the foundation is signed off.
      </p>
      <div className="border border-zinc-800/80 rounded-lg p-8 bg-zinc-900/30 text-zinc-500 text-sm">
        Placeholder · sidebar nav between sections is instant (client-side routing).
      </div>
    </div>
  )
}
