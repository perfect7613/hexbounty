import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="page page--narrow">
      <p className="kicker">404</p>
      <h1>No such cabinet</h1>
      <p>That path is not in the arcade.</p>
      <Button asChild>
        <Link href="/">Return to arcade</Link>
      </Button>
    </div>
  );
}
