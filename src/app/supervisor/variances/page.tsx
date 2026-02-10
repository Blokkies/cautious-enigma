"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";

interface VarianceItem {
  countId: number;
  itemCode: string;
  description: string | null;
  brand: string | null;
  binNumber: string | null;
  onHand: number | null;
  avgCost: number | null;
  countedQty: number;
  variance: number;
  varianceValue: number;
  teamName: string;
  comment: string | null;
  checkStatus: string;
  countedAt: string;
}

export default function VariancesPage() {
  const [variances, setVariances] = useState<VarianceItem[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadVariances = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/variances");
      if (res.ok) {
        const data = await res.json();
        setVariances(data.variances || []);
        setTotalValue(data.totalVarianceValue || 0);
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVariances();
    const interval = setInterval(loadVariances, 15000);
    return () => clearInterval(interval);
  }, [loadVariances]);

  const filtered = search
    ? variances.filter(
        (v) =>
          v.itemCode.toLowerCase().includes(search.toLowerCase()) ||
          v.description?.toLowerCase().includes(search.toLowerCase()) ||
          v.binNumber?.toLowerCase().includes(search.toLowerCase()) ||
          v.teamName.toLowerCase().includes(search.toLowerCase())
      )
    : variances;

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Variances</h1>
        <Badge variant="destructive" className="text-sm">
          R{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} total
        </Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search variances..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Code</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead>Bin</TableHead>
                  <TableHead className="text-right">On Hand</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Value</TableHead>
                  <TableHead>Team</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {search ? "No matching variances" : "No variances recorded"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((v) => (
                    <TableRow key={v.countId}>
                      <TableCell className="font-mono text-sm">
                        {v.itemCode}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate">
                        {v.description}
                      </TableCell>
                      <TableCell className="text-sm">{v.binNumber}</TableCell>
                      <TableCell className="text-right">{v.onHand}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {v.countedQty}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            Math.abs(v.variance) > 10
                              ? "destructive"
                              : "outline"
                          }
                          className={
                            Math.abs(v.variance) <= 10
                              ? "border-amber-400 text-amber-700"
                              : ""
                          }
                        >
                          {v.variance > 0 ? "+" : ""}
                          {v.variance}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell text-sm">
                        R{Math.abs(v.varianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </TableCell>
                      <TableCell className="text-sm">{v.teamName}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground">
        {filtered.length} variance{filtered.length !== 1 ? "s" : ""} total
      </div>
    </div>
  );
}
