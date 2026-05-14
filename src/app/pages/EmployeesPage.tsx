import { useMemo, useState } from "react";
import { Search, Users, Clock, UserX, ShieldCheck } from "lucide-react";
import { useAttendance } from "../context/AttendanceContext";
import {
  PageHeader,
  StatCard,
  Card,
  Input,
  DataTable,
  type Column,
} from "../components/ui";

type MasterEmployee = {
  fullName: string;
};

type EmployeeRow = {
  fullName: string;
  lateExemptionsCount: number;
  absenceCount: number;
  latesCount: number;
  totalUndertime: number;
};

const MASTER_EMPLOYEES: MasterEmployee[] = [
  { fullName: "Agravio, John Maric" },
  { fullName: "Aquino, Armando" },
  { fullName: "Cantillon, Ma. Louissa" },
  { fullName: "Codilan, Ian Christopher" },
  { fullName: "Cruz, Gino" },
  { fullName: "Cruz, Nathaniel Philip" },
  { fullName: "Engay, Lovely Jane" },
  { fullName: "Loterte, Jenny Lyn" },
  { fullName: "Pascua, Joseph" },
  { fullName: "Pascual, Lucky Joy" },
  { fullName: "Pesquerra, Louis Gabriel" },
  { fullName: "Ramirez, Rejohn" },
  { fullName: "Raquem, Karl Anthony" },
  { fullName: "Tapat, Leilani" },
  { fullName: "Yatsu, Nanako" },
  { fullName: "Aclan, Junrey" },
  { fullName: "Arroyo, Nilo" },
  { fullName: "Azcueta, Jerwin" },
  { fullName: "Bajar, Joseph" },
  { fullName: "Bautista, Gerry" },
  { fullName: "Bayan, Juewars" },
  { fullName: "Bertulfo, Hermilo" },
  { fullName: "Bido, Alonzo" },
  { fullName: "Bonaobra, Davidson" },
  { fullName: "Cababat, Chesterson" },
  { fullName: "Caban, Cris" },
  { fullName: "Calicdan, Ednerson" },
  { fullName: "Campita, Justin" },
  { fullName: "Clemente Jr., Ricardo" },
  { fullName: "Coste, Welmar" },
  { fullName: "De Jesus, Roy Roldan" },
  { fullName: "Dometita, Bryan Lloyd" },
  { fullName: "Escarcha, Carlito" },
  { fullName: "Estuaria, Christian" },
  { fullName: "Francisco, Jhon Mar" },
  { fullName: "Hiteroza, Isauro" },
  { fullName: "Magday, Elmer" },
  { fullName: "Mapa, Arnel" },
  { fullName: "Meeks, Bryan" },
  { fullName: "Obligar, Bernal" },
  { fullName: "Olesco, Alvin" },
  { fullName: "Omapas Jr., Teddy" },
  { fullName: "Omegan, Jayson" },
  { fullName: "Radaza, Marifie" },
  { fullName: "Samson, John Paul" },
  { fullName: "Sisbas, Jessie" },
  { fullName: "Soriano, Ariel" },
  { fullName: "Suarez, Elmer" },
  { fullName: "Urbano, Ronald" },
  { fullName: "Veruela, John Wally" },
  { fullName: "Zate, Mario" },
];

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ");
}

function formatMinutes(minutes: number) {
  if (!minutes || minutes <= 0) return "—";

  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} min`;
  if (hrs > 0) return `${hrs} hr`;
  return `${mins} min`;
}

function formatCount(value: number) {
  return value > 0 ? value : "—";
}

function getInitials(name: string) {
  const parts = name
    .replace(/,/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function normalizeEmployeePhotoFileName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "-");
}

function getEmployeePhoto(name: string) {
  const fileName = normalizeEmployeePhotoFileName(name);
  return `/employees/${fileName}.jpg`;
}

function EmployeeAvatar({ name }: { name: string }) {
  const [hasError, setHasError] = useState(false);
  const photo = getEmployeePhoto(name);

  if (!hasError) {
    return (
      <img
        src={photo}
        alt={name}
        onError={() => setHasError(true)}
        className="h-10 w-10 rounded-full border border-slate-200 object-cover flex-shrink-0"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 border border-brand-100 flex-shrink-0">
      {getInitials(name)}
    </div>
  );
}

export default function EmployeesPage() {
  const {
    lateRecords = [],
    exemptions = [],
    absences = [],
    generatedUndertimes = [],
    manualUndertimes = [],
  } = useAttendance();

  const [search, setSearch] = useState("");

  const employees = useMemo<EmployeeRow[]>(() => {
    const map = new Map<string, EmployeeRow>();

    const ensureEmployee = (name: string) => {
      const cleanName = name?.trim();
      if (!cleanName) return null;

      const key = normalizeName(cleanName);

      if (!map.has(key)) {
        map.set(key, {
          fullName: cleanName,
          lateExemptionsCount: 0,
          absenceCount: 0,
          latesCount: 0,
          totalUndertime: 0,
        });
      }

      return map.get(key)!;
    };

    MASTER_EMPLOYEES.forEach((emp) => {
      ensureEmployee(emp.fullName);
    });

    lateRecords.forEach((late) => {
      const employee = ensureEmployee(late.name);
      if (!employee) return;
      employee.latesCount += 1;
    });

    exemptions.forEach((item) => {
      const employee = ensureEmployee(item.name);
      if (!employee) return;
      employee.lateExemptionsCount += 1;
    });

    absences.forEach((item) => {
      const employee = ensureEmployee(item.name);
      if (!employee) return;
      employee.absenceCount += 1;
    });

    generatedUndertimes.forEach((item) => {
      const employee = ensureEmployee(item.name);
      if (!employee) return;
      employee.totalUndertime += 1;
    });

    manualUndertimes.forEach((item) => {
      const employee = ensureEmployee(item.name);
      if (!employee) return;

      const hours = Number(item.undertimeHours || 0);
      employee.totalUndertime += hours * 60;
    });

    return Array.from(map.values()).sort((a, b) =>
      a.fullName.localeCompare(b.fullName)
    );
  }, [lateRecords, exemptions, absences, generatedUndertimes, manualUndertimes]);

  const filteredEmployees = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return employees;
    return employees.filter((emp) =>
      emp.fullName.toLowerCase().includes(keyword)
    );
  }, [employees, search]);

  const withLatesCount = employees.filter((e) => e.latesCount > 0).length;
  const withAbsencesCount = employees.filter((e) => e.absenceCount > 0).length;
  const withExemptionsCount = employees.filter(
    (e) => e.lateExemptionsCount > 0
  ).length;

  const columns: Column<EmployeeRow>[] = [
    {
      key: "employee",
      header: "Employee",
      render: (emp) => (
        <div className="flex items-center gap-3 min-w-0">
          <EmployeeAvatar name={emp.fullName} />
          <p className="font-medium text-slate-900 truncate">{emp.fullName}</p>
        </div>
      ),
    },
    {
      key: "exemptions",
      header: "Exemptions",
      align: "right",
      render: (emp) => formatCount(emp.lateExemptionsCount),
    },
    {
      key: "absences",
      header: "Absences",
      align: "right",
      render: (emp) => formatCount(emp.absenceCount),
    },
    {
      key: "lates",
      header: "Lates",
      align: "right",
      render: (emp) => (
        <span className="font-semibold text-slate-900">
          {formatCount(emp.latesCount)}
        </span>
      ),
    },
    {
      key: "undertime",
      header: "Total Undertime",
      align: "right",
      render: (emp) => formatMinutes(emp.totalUndertime),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Permanent employee list with attendance-based totals."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Employees"
          value={MASTER_EMPLOYEES.length}
          icon={Users}
          tone="brand"
        />
        <StatCard
          label="With Lates"
          value={withLatesCount}
          icon={Clock}
          tone="warning"
        />
        <StatCard
          label="With Absences"
          value={withAbsencesCount}
          icon={UserX}
          tone="danger"
        />
        <StatCard
          label="With Exemptions"
          value={withExemptionsCount}
          icon={ShieldCheck}
          tone="success"
        />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Employee Directory
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Counts reflect uploaded attendance and manual entries.
            </p>
          </div>

          <div className="w-full sm:w-72">
            <Input
              type="search"
              placeholder="Search employee name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={filteredEmployees}
          rowKey={(emp) => normalizeName(emp.fullName)}
          emptyTitle="No employee found"
          emptyDescription="Try adjusting your search."
          emptyIcon={<Users className="w-6 h-6" />}
        />
      </Card>
    </div>
  );
}
