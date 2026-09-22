import { createBrowserRouter } from "react-router";

import { LandingPage } from "@/pages/landing/LandingPage";

export const router = createBrowserRouter([{ path: "/", Component: LandingPage }]);
