import NoiseLab from "./noise-lab";
import { missingAuthEnv } from "@/lib/auth";

export default function Page() {
  return <NoiseLab authConfigured={missingAuthEnv().length === 0} />;
}
