import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import RunDetail from "./pages/RunDetail.jsx";
import RunsList from "./pages/RunsList.jsx";

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<RunsList />} />
                <Route path="/runs/:id" element={<RunDetail />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
