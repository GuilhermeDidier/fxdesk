import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="sheet mx-auto max-w-md p-8 text-center">
      <h1 className="font-display text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-sm text-muted">This record does not exist, or it belongs to another company.</p>
      <Link href="/" className="btn-quiet mt-5">
        Back to the overview
      </Link>
    </div>
  );
}
