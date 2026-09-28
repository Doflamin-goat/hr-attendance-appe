import type { Employee } from "../../services/employeeService";
import { SearchableCombobox } from "../ui";

type Props = {
  employees: Employee[];
  selectedEmployeeId: string;
  onChange: (employeeId: string) => void;
};

export function EmployeeFilterCombobox({ employees, selectedEmployeeId, onChange }: Props) {
  const options = [...employees]
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((employee) => ({ id: employee.id, label: employee.fullName }));
  const selectedLabel = options.find((option) => option.id === selectedEmployeeId)?.label ?? "";

  return <div>
    <SearchableCombobox label="Search Employee" placeholder="Search or select employee" options={options} value={selectedLabel} onSelect={(option) => onChange(option.id)} onClear={() => onChange("")} />
    {selectedEmployeeId ? <button type="button" className="mt-1.5 text-xs font-medium text-brand-700 hover:text-brand-800" onClick={() => onChange("")}>Clear employee filter</button> : null}
  </div>;
}
