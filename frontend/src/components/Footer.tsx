// API terms of service: cite retrieval dates and the OPR disclaimer.

import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function Footer() {
  const meta = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: Infinity });
  if (!meta.data) return null;
  const from = meta.data.retrieved_from?.slice(0, 10);
  const to = meta.data.retrieved_to?.slice(0, 10);
  return (
    <footer className="app-footer">
      <p>
        Data retrieved from the Lobbying Disclosure Act database (lda.gov)
        {from && to && ` between ${from} and ${to}`}. {meta.data.disclaimer}
      </p>
    </footer>
  );
}
