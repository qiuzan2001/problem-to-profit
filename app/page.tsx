import Dashboard from '../components/Dashboard.tsx';

export default function Page() {
  return (
    <main>
      <h1>Click GO → $1,000,000 in revenue?</h1>
      <p className="sub">
        The acceptance criterion in the spec has no verifiable postcondition: revenue is not a
        function of a click. This app runs the funnel model that clause is skipping — 2,000 seeded
        Monte Carlo sample paths over your traffic, conversion, price and churn assumptions — and
        reports the probability, not a promise.
      </p>
      <Dashboard />
    </main>
  );
}
