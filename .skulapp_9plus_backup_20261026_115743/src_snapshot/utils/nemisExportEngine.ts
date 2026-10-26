/**
 * Official Ministry of Education (MoE) & KNEC CBA Standard Batch Exporters
 * Conforms to nemis.education.go.ke & cba.knec.ac.ke specification templates.
 */

export interface StatutoryLearner {
  admission_number: string;
  surname: string;
  first_name: string;
  other_names?: string;
  gender: 'M' | 'F';
  dob: string; // YYYY-MM-DD
  birth_cert_no: string;
  nemis_upi?: string;
  grade: string;
  father_name: string;
  father_id: string;
  mother_name: string;
  mother_id: string;
  parent_phone: string;
  special_needs: 'NONE' | 'VISUAL' | 'HEARING' | 'PHYSICAL' | 'MENTAL';
}

export interface KNECAssessmentRow {
  knec_assessment_no: string;
  learner_name: string;
  gender: 'M' | 'F';
  grade: string;
  learning_area: string;
  strand: string;
  rubric_level: 'EE' | 'ME' | 'AE' | 'BE';
  score_raw: 1 | 2 | 3 | 4;
}

// 1. Export in exact MoE NEMIS Batch Upload CSV Format
export const exportNEMISBatchCSV = (learners: StatutoryLearner[], filename = 'NEMIS_Batch_Upload_Mandongoi.csv') => {
  const headers = [
    'Admission_Number',
    'Surname',
    'First_Name',
    'Other_Names',
    'Gender',
    'Date_Of_Birth',
    'Birth_Certificate_Entry_No',
    'NEMIS_UPI',
    'Grade_Level',
    'Father_Full_Name',
    'Father_National_ID',
    'Mother_Full_Name',
    'Mother_National_ID',
    'Primary_Contact_Phone',
    'Special_Needs_Category'
  ];

  const rows = learners.map(l => [
    `"${l.admission_number}"`,
    `"${l.surname}"`,
    `"${l.first_name}"`,
    `"${l.other_names || ''}"`,
    `"${l.gender}"`,
    `"${l.dob}"`,
    `"${l.birth_cert_no}"`,
    `"${l.nemis_upi || 'PENDING_REGISTRATION'}"`,
    `"${l.grade}"`,
    `"${l.father_name}"`,
    `"${l.father_id}"`,
    `"${l.mother_name}"`,
    `"${l.mother_id}"`,
    `"${l.parent_phone}"`,
    `"${l.special_needs}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  triggerDownload(csvContent, filename);
};

// 2. Export in exact KNEC CBA Portal Assessment Format
export const exportKNECCBAAssessmentCSV = (assessments: KNECAssessmentRow[], filename = 'KNEC_CBA_Grade5_Scores.csv') => {
  const headers = [
    'KNEC_Assessment_Number',
    'Learner_Full_Name',
    'Gender',
    'Grade',
    'Learning_Area',
    'Strand',
    'Rubric_Level',
    'Numerical_Equivalent'
  ];

  const rows = assessments.map(a => [
    `"${a.knec_assessment_no}"`,
    `"${a.learner_name}"`,
    `"${a.gender}"`,
    `"${a.grade}"`,
    `"${a.learning_area}"`,
    `"${a.strand}"`,
    `"${a.rubric_level}"`,
    a.score_raw
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  triggerDownload(csvContent, filename);
};

const triggerDownload = (content: string, filename: string) => {
  const encodedUri = encodeURI(content);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
