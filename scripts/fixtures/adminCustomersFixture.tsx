import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { CustomersTable } from "../../src/components/admin/customers/CustomersTable";
import type { Coupon } from "../../src/types";
import "../../src/styles/index.css";
const root = createRoot(document.getElementById("root")!);
root.render(<StrictMode><MemoryRouter><CustomersTable coupons={[{ id: "coupon-local", code: "CLIENT10", isActive: true } as Coupon]} /></MemoryRouter></StrictMode>);
