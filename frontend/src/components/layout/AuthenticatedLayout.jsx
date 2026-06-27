import { Outlet } from "react-router-dom";
import AppLayout from "./AppLayout";

/** Stable route layout — do not define inline in App.js (avoids remount on every render). */
export default function AuthenticatedLayout() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
