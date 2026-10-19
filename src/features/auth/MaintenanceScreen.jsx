// What a player sees while maintenance is on (the rule: maintenanceBlocks in authRules.js). Docs:
// docs/modules/accounts/sign-in.md.
import { Wrench } from "lucide-react";

export function MaintenanceScreen({ message }) {
  return (
    <main className="splash" role="status">
      <div className="splash-inner">
        <h1 className="auth-title">Word <span>Hunter</span></h1>
        <p className="load-error"><Wrench size={16} /> {message}</p>
        <button className="auth-submit" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </main>
  );
}
