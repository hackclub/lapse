import { Checkbox } from "@/components/ui/Checkbox";
import { setAdminViewHidden, useAdminView } from "@/hooks/useAdminView";

export function AdminTab() {
  const adminView = useAdminView();

  return (
    <div className="flex flex-col gap-6">
      <Checkbox
        label="Show hidden timelapses"
        description="Show unlisted, failed, and processing timelapses of other users, marked with an orange dashed border. Turn this off before screen sharing. Only applies to this device."
        checked={!adminView.hidden}
        onChange={checked => setAdminViewHidden(!checked)}
      />
    </div>
  );
}
