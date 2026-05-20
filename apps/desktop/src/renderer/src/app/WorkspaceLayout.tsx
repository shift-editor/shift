import { Navigate, Route, Routes } from "react-router-dom";
import { Home } from "@/views/Home";
import { Editor } from "@/views/Editor";

export const WorkspaceLayout = () => {
  return (
    <div className="h-full w-full">
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/editor/:glyphId" element={<Editor />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </div>
  );
};
