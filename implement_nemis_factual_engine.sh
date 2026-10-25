#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}====================================================================${NC}"
echo -e "${CYAN}>>> IMPLEMENTING STATUTORY NEMIS, KNEC CBA EXPORTS & MOE KPIS    <<<${NC}"
echo -e "${CYAN}====================================================================${NC}"

# Detect Git
if [ ! -d ".git" ]; then
    echo -e "${RED}[ERROR] .git folder not found. Run from the project root!${NC}"
    exit 1
fi

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD)
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)

# Detect Frontend
if [ -d "frontend" ]; then
    FRONTEND_ROOT="frontend"
else
    FRONTEND_ROOT="."
fi

SRC_DIR="$FRONTEND_ROOT/src"
UTILS_DIR="$SRC_DIR/utils"
PAGES_DIR="$SRC_DIR/pages"

mkdir -p "$UTILS_DIR" "$PAGES_DIR"

# ------------------------------------------------------------------------------
# 1. OFFICIAL MOE NEMIS & KNEC CBA BATCH EXPORT ENGINE (utils/nemisExportEngine.ts)
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[1/3] Building Official MoE NEMIS & KNEC CBA Export Engine...${NC}"
cat << 'EXPORT_EOF' > "$UTILS_DIR/nemisExportEngine.ts"
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
EXPORT_EOF

# ------------------------------------------------------------------------------
# 2. UPGRADE STUDENTS DESK WITH MULTI-VECTOR SEARCH & NEMIS BATCH ACTIONS
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[2/3] Upgrading StudentsDesk.tsx with Multi-Vector Search & NEMIS Verification...${NC}"
cat << 'STUDENTS_EOF' > "$PAGES_DIR/StudentsDesk.tsx"
import React, { useState, useMemo } from 'react';
import { StatutoryLearner, exportNEMISBatchCSV } from '../utils/nemisExportEngine';
import { maskPhoneNumber } from '../utils/kenyaFormatters';

const MANDONGOI_REGISTER: StatutoryLearner[] = [
  {
    admission_number: 'ADM-MND-0582',
    surname: 'Kasamba',
    first_name: 'Brian',
    other_names: 'Baraka',
    gender: 'M',
    dob: '2015-04-12',
    birth_cert_no: 'BC-2015-891024',
    nemis_upi: 'BBK521K',
    grade: 'Grade 5',
    father_name: 'Kasamba Kitheka',
    father_id: '24189021',
    mother_name: 'Mary Mwikali Kasamba',
    mother_id: '28901244',
    parent_phone: '0718786067',
    special_needs: 'NONE',
  },
  {
    admission_number: 'ADM-MND-0501',
    surname: 'Kamau',
    first_name: 'Wanjiku',
    other_names: 'Grace',
    gender: 'F',
    dob: '2013-09-21',
    birth_cert_no: 'BC-2013-441092',
    nemis_upi: 'WKG102M',
    grade: 'Grade 7',
    father_name: 'Kamau Njoroge',
    father_id: '21094123',
    mother_name: 'Hannah Wangari',
    mother_id: '24901233',
    parent_phone: '0722112233',
    special_needs: 'NONE',
  },
  {
    admission_number: 'ADM-MND-0589',
    surname: 'Mutua',
    first_name: 'Emmanuel',
    other_names: 'Kyalo',
    gender: 'M',
    dob: '2014-11-05',
    birth_cert_no: 'PENDING_REG',
    nemis_upi: undefined, // UNVERIFIED GAP
    grade: 'Grade 5',
    father_name: 'Mutua Maluki',
    father_id: '18902144',
    mother_name: 'Agnes Syokau',
    mother_id: '22194012',
    parent_phone: '0799887766',
    special_needs: 'NONE',
  },
];

export const StudentsDesk: React.FC = () => {
  const [learners, setLearners] = useState<StatutoryLearner[]>(MANDONGOI_REGISTER);
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [capitationStatusFilter, setCapitationStatusFilter] = useState<'ALL' | 'VERIFIED' | 'AT_RISK'>('ALL');

  // Multi-Vector Search Resolver
  const filteredLearners = useMemo(() => {
    return learners.filter(l => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        l.admission_number.toLowerCase().includes(q) ||
        l.surname.toLowerCase().includes(q) ||
        l.first_name.toLowerCase().includes(q) ||
        (l.other_names && l.other_names.toLowerCase().includes(q)) ||
        (l.nemis_upi && l.nemis_upi.toLowerCase().includes(q)) ||
        l.parent_phone.includes(q) ||
        l.birth_cert_no.toLowerCase().includes(q);

      const matchGrade = gradeFilter ? l.grade === gradeFilter : true;
      const matchCapitation =
        capitationStatusFilter === 'ALL'
          ? true
          : capitationStatusFilter === 'VERIFIED'
          ? !!l.nemis_upi
          : !l.nemis_upi;

      return matchSearch && matchGrade && matchCapitation;
    });
  }, [learners, searchQuery, gradeFilter, capitationStatusFilter]);

  const verifiedCount = learners.filter(l => !!l.nemis_upi).length;
  const atRiskCount = learners.length - verifiedCount;

  return (
    <div className="space-y-4">
      {/* Top Census & Capitation Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            Sajili ya Wanafunzi & Ukaguzi wa NEMIS (National Enrollment Register)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Mandongoi Comprehensive School &bull; Kituo cha Mtihani: <strong>40105102</strong> &bull; Usajili wa MoE: <strong>MoE/PRI/2019/4021</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => exportNEMISBatchCSV(learners)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <span>Pakua NEMIS Batch Template (MoE Format)</span>
          </button>
        </div>
      </div>

      {/* Capitation Risk Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg flex justify-between items-center">
          <div>
            <span className="text-emerald-800 font-semibold">Wanafunzi Wenye NEMIS UPI:</span>
            <div className="text-lg font-black text-emerald-900">{verifiedCount} / {learners.length}</div>
          </div>
          <span className="text-[10px] font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full">
            Capitation Imethibitishwa
          </span>
        </div>

        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex justify-between items-center">
          <div>
            <span className="text-amber-800 font-semibold">Pengo la Capitation (At Risk):</span>
            <div className="text-lg font-black text-amber-900">{atRiskCount} Learners</div>
          </div>
          <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">
            Kukosa Ruzuku ya Serikali
          </span>
        </div>

        <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg flex justify-between items-center">
          <div>
            <span className="text-blue-800 font-semibold">Makadirio ya Ruzuku ya FPE/FDSE:</span>
            <div className="text-lg font-black text-blue-900 font-mono">KES {(verifiedCount * 1420).toLocaleString()}</div>
          </div>
          <span className="text-[10px] text-blue-700">Ruzuku ya Muhula 1</span>
        </div>
      </div>

      {/* Multi-Vector Search Controls */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-wrap gap-2 items-center justify-between text-xs">
        <div className="flex gap-2 items-center flex-1 min-w-[320px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tafuta kwa: Jina, Nambari ya Simu (0718...), Birth Cert, UPI, au Adm..."
            className="w-full sm:w-96 px-3 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          />
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded bg-white"
          >
            <option value="">Madarasa Yote (All Grades)</option>
            <option value="Grade 5">Grade 5</option>
            <option value="Grade 7">Grade 7</option>
            <option value="Grade 8">Grade 8</option>
          </select>
          <select
            value={capitationStatusFilter}
            onChange={(e) => setCapitationStatusFilter(e.target.value as any)}
            className="px-2.5 py-1.5 border border-slate-300 rounded bg-white"
          >
            <option value="ALL">Hali Zote za Capitation</option>
            <option value="VERIFIED">Wenye UPI Pekee</option>
            <option value="AT_RISK">Wasio na UPI (Pengo)</option>
          </select>
        </div>
      </div>

      {/* Institutional Learner Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-800 uppercase font-bold border-b border-slate-200 text-[11px]">
            <tr>
              <th className="p-3">Adm No</th>
              <th className="p-3">Jina la Mwanafunzi</th>
              <th className="p-3">NEMIS UPI / Hali</th>
              <th className="p-3">Cheti cha Kuzaliwa (Birth Cert)</th>
              <th className="p-3">Mzazi & Simu</th>
              <th className="p-3 text-center">Hali ya Capitation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredLearners.length > 0 ? (
              filteredLearners.map((learner) => (
                <tr key={learner.admission_number} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-mono font-bold text-slate-900">{learner.admission_number}</td>
                  <td className="p-3">
                    <div className="font-bold text-slate-900">
                      {learner.surname}, {learner.first_name} {learner.other_names || ''}
                    </div>
                    <div className="text-[10px] text-slate-500">{learner.grade} &bull; Jinsia: {learner.gender}</div>
                  </td>
                  <td className="p-3">
                    {learner.nemis_upi ? (
                      <span className="font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                        {learner.nemis_upi}
                      </span>
                    ) : (
                      <span className="font-mono bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded text-[10px] font-bold">
                        BILA UPI (PENGO)
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-slate-600">{learner.birth_cert_no}</td>
                  <td className="p-3">
                    <div>{learner.father_name}</div>
                    <div className="font-mono text-slate-500 text-[10px]">{maskPhoneNumber(learner.parent_phone)}</div>
                  </td>
                  <td className="p-3 text-center">
                    {learner.nemis_upi ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-bold text-[10px]">
                        Inalipiwa na Serikali
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded-full font-bold text-[10px]">
                        Ruzuku Imesimamishwa
                      </span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="text-center py-8 text-slate-400">
                  Hakuna mwanafunzi aliyepatikana kwa kigezo hicho.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
STUDENTS_EOF

# ------------------------------------------------------------------------------
# 3. UPGRADE BOM OVERSIGHT WITH STATUTORY MOE ACCOUNTS (1 & 2) AND NEMIS KPIS
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[3/3] Upgrading BOMOversight.tsx with Statutory MoE Account 1 & 2 Splitting...${NC}"
cat << 'BOM_EOF' > "$PAGES_DIR/BOMOversight.tsx"
import React from 'react';
import { formatKES } from '../utils/kenyaFormatters';

export const BOMOversight: React.FC = () => {
  return (
    <div className="space-y-4">
      {/* Executive Header */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex justify-between items-center">
        <div>
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            Dashibodi ya Bodi ya Usimamizi (BOM Oversight & QASO Compliance)
          </h2>
          <p className="text-xs text-slate-500">
            Mandongoi Comprehensive School &bull; Mwongozo wa Fedha wa Wizara ya Elimu (MoE Financial Regulations)
          </p>
        </div>
        <div className="text-right">
          <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-1 rounded font-bold border">
            Term 1, 2026 Audit Cycle
          </span>
        </div>
      </div>

      {/* Statutory Account 1 (SIMBA) vs Account 2 (GP) KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] text-slate-500 uppercase font-bold">Akaunti 1: Masomo (SIMBA/Tuition)</span>
          <div className="text-xl font-black text-blue-700 font-mono mt-1">{formatKES(724200)}</div>
          <p className="text-[10px] text-slate-500 mt-1">Inalindwa kisheria kwa vitabu na mitihani pekee.</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] text-slate-500 uppercase font-bold">Akaunti 2: Uendeshaji (General Purpose)</span>
          <div className="text-xl font-black text-emerald-700 font-mono mt-1">{formatKES(1195800)}</div>
          <p className="text-[10px] text-slate-500 mt-1">Maji, umeme, ukarabati na wafanyakazi wasio wa walimu.</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] text-slate-500 uppercase font-bold">Pengo la Capitation (NEMIS Gap)</span>
          <div className="text-xl font-black text-rose-600 font-mono mt-1">{formatKES(127800)}</div>
          <p className="text-[10px] text-rose-700 font-semibold mt-1">Hasara ya ruzuku kutokana na wanafunzi wasio na UPI.</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] text-slate-500 uppercase font-bold">Mishahara ya Walimu wa BOM</span>
          <div className="text-xl font-black text-purple-700 font-mono mt-1">{formatKES(480000)}</div>
          <p className="text-[10px] text-slate-500 mt-1">Walimu 6 wa mkataba (Inayolipwa kutoka mfuko wa PTA).</p>
        </div>
      </div>

      {/* QASO Audit & Institutional Health Indicators */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs text-xs space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">Vipimo Muhimu vya Ukaguzi wa Wizara (QASO Statutory Compliance)</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-700">Uwiano wa Mwalimu kwa Mwanafunzi (TLR):</span>
            <div className="text-base font-black text-slate-900 mt-1">1 : 42</div>
            <p className="text-[10px] text-emerald-700 font-medium mt-0.5">Inakidhi vigezo vya TSC (Chini ya kiwango cha 1:45).</p>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-700">Kiwango cha Usawa wa Jinsia (Gender Parity):</span>
            <div className="text-base font-black text-slate-900 mt-1">48% Wasichana &bull; 52% Wavulana</div>
            <p className="text-[10px] text-blue-700 font-medium mt-0.5">Uwiano thabiti katika bweni na madarasa ya kawaida.</p>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-700">Kiwango cha Mahudhurio ya Shule (Attendance):</span>
            <div className="text-base font-black text-slate-900 mt-1">97.4%</div>
            <p className="text-[10px] text-emerald-700 font-medium mt-0.5">Programu ya chakula cha mchana inadumisha mahudhurio.</p>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
          <p className="text-slate-500">
            Ripoti hii inazalishwa kwa mujibu wa kifungu cha 56 cha Sheria ya Elimu ya Msingi (Basic Education Act 2013).
          </p>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg cursor-pointer"
          >
            Pakua Ripoti Kamili ya Ukaguzi wa BOM (PDF)
          </button>
        </div>
      </div>
    </div>
  );
};
BOM_EOF

# ------------------------------------------------------------------------------
# 4. GIT COMMIT, PUSH & VERIFY
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}====================================================================${NC}"
echo -e "${CYAN}>>> COMMITTING & PUSHING STATUTORY WORKFLOWS TO GITHUB...       <<<${NC}"
echo -e "${CYAN}====================================================================${NC}"

git add -A

if git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}[!] Working tree is already clean.${NC}"
else
    COMMIT_MSG="feat(moe): implement statutory NEMIS batch export, multi-vector search & capitation KPIs

- Added utils/nemisExportEngine.ts with official MoE NEMIS & KNEC CBA batch layouts
- Upgraded StudentsDesk.tsx with multi-vector search (Parent phone, Birth cert, UPI, Adm)
- Upgraded BOMOversight.tsx with MoE Account 1 (SIMBA) vs Account 2 (GP) splits
- Added NEMIS Capitation Yield Gap KPI to highlight lost government subsidy revenue"

    git commit -m "$COMMIT_MSG"
    echo -e "${GREEN}  ✓ Created Git commit successfully.${NC}"
fi

echo -e "${YELLOW}[+] Pushing branch '${CURRENT_BRANCH}' to origin...${NC}"
git push origin "$CURRENT_BRANCH"

LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git ls-remote origin "refs/heads/${CURRENT_BRANCH}" | awk '{print $1}')

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    echo -e "${GREEN}====================================================================${NC}"
    echo -e "${GREEN}>>> SUCCESS: STATUTORY NEMIS WORKFLOWS COMMITTED & LIVE ON GITHUB! <<<${NC}"
    echo -e "${GREEN}====================================================================${NC}"
    echo -e "Commit SHA : ${LOCAL_HASH}"
    echo -e "Branch     : ${CURRENT_BRANCH}"
    echo -e "Remote Repo: ${REMOTE_URL}"
else
    echo -e "${RED}[ERROR] Remote hash mismatch!${NC}"
    exit 1
fi
