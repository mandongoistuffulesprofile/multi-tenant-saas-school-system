// The rubric screen is still plain JSX; this declares the surface the typed
// pages and tests use so they do not have to fall back to `any`.
import type { FC } from "react";

export interface CBCSubStrand {
  id: string;
  name?: string;
}

export interface CBCLearner {
  id: string;
  name: string;
  admissionNumber?: string;
  initialScoreCode?: string;
}

export interface CBCRubricAssessmentProps {
  tenantId: string;
  subStrand?: CBCSubStrand;
  learners?: CBCLearner[];
}

declare const CBCRubricAssessment: FC<CBCRubricAssessmentProps>;
export default CBCRubricAssessment;
