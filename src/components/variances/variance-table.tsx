"use client";

import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClipboardCheck, ChevronRight, ChevronDown, Check, RotateCcw, X as XIcon, Pencil, MessageSquare } from "lucide-react";
import { groupSerializedVariances, type SerializedGroupRow } from "@/lib/variance-grouping";
import type { AcceptAction, VarianceItem } from "./types";

interface VarianceTableProps {
  items: VarianceItem[];
  emptyMessage: string;
  showEditButton: boolean;
  showCheckbox: boolean;
  showAcceptButton?: boolean;
  showReopenButton?: boolean;
  groupsCollapsed?: boolean;
  isResolvedTab?: boolean;
  onEdit?: (item: VarianceItem) => void;
  selectedCountIds?: Set<number>;
  onToggleSelect?: (countId: number) => void;
  canSelect?: (item: VarianceItem) => boolean;
  onAccept?: (
    action: AcceptAction,
    item: VarianceItem
  ) => void;
  onAcceptVariance?: (item: VarianceItem) => void;
  onReopenVariance?: (item: VarianceItem) => void;
  onApproveUnknownSerial?: (item: VarianceItem) => void;
  onDismissUnknownSerial?: (item: VarianceItem) => void;
  onEditUnknownSerial?: (item: VarianceItem) => void;
  onSerialVerify?: (item: VarianceItem) => void;
  isSaving?: boolean;
}

// Shared table component for all tabs
export function VarianceTable({
  items,
  emptyMessage,
  showEditButton,
  showCheckbox,
  showAcceptButton,
  showReopenButton,
  groupsCollapsed,
  isResolvedTab,
  onEdit,
  selectedCountIds,
  onToggleSelect,
  canSelect,
  onAccept,
  onAcceptVariance,
  onReopenVariance,
  onApproveUnknownSerial,
  onDismissUnknownSerial,
  onEditUnknownSerial,
  onSerialVerify,
  isSaving,
}: VarianceTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set());

  const toggleComment = (countId: number) => {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(countId)) next.delete(countId);
      else next.add(countId);
      return next;
    });
  };

  const displayRows = useMemo(
    () => groupSerializedVariances(items),
    [items]
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroupCheckbox = (group: SerializedGroupRow<VarianceItem>) => {
    if (!onToggleSelect) return;
    const allSelected = group.countIds.every((id) => selectedCountIds?.has(id));
    for (const id of group.countIds) {
      const item = group.items.find((i) => i.countId === id);
      if (item && canSelect?.(item)) {
        if (allSelected) {
          // Deselect all
          if (selectedCountIds?.has(id)) onToggleSelect(id);
        } else {
          // Select all
          if (!selectedCountIds?.has(id)) onToggleSelect(id);
        }
      }
    }
  };

  const rowProps: RowProps = {
    showEditButton,
    showCheckbox,
    showAcceptButton,
    showReopenButton,
    isResolvedTab,
    onEdit,
    selectedCountIds,
    onToggleSelect,
    canSelect,
    onAccept,
    onAcceptVariance,
    onReopenVariance,
    onApproveUnknownSerial,
    onDismissUnknownSerial,
    onEditUnknownSerial,
    onSerialVerify,
    isSaving,
    expandedComments,
    onToggleComment: toggleComment,
  };

  const colSpan = (showCheckbox ? 1 : 0) + 9 + (showEditButton ? 1 : 0);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {showCheckbox && <TableHead className="w-10"></TableHead>}
                <TableHead>Item Code</TableHead>
                <TableHead className="hidden md:table-cell">
                  Description
                </TableHead>
                <TableHead>Bin</TableHead>
                <TableHead className="text-right">On Hand</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right hidden md:table-cell">
                  Value
                </TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Verification</TableHead>
                {showEditButton && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={colSpan}
                    className="text-center py-8 text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((row) => {
                  if (row.type === "single") {
                    return renderSingleRow(row.item, rowProps);
                  }

                  // Serialized group
                  const groupKey = `${row.itemCode}::${row.binNumber || ""}`;
                  const isExpanded = !groupsCollapsed && expandedGroups.has(groupKey);
                  const selectableInGroup = row.items.filter((i) => canSelect?.(i));
                  const allGroupSelected =
                    selectableInGroup.length > 0 &&
                    selectableInGroup.every((i) => selectedCountIds?.has(i.countId));

                  return (
                    <React.Fragment key={groupKey}>
                      {/* Group header row */}
                      <TableRow
                        className={`bg-purple-50/60 ${groupsCollapsed ? "" : "hover:bg-purple-100/60 cursor-pointer"}`}
                        onClick={groupsCollapsed ? undefined : () => toggleGroup(groupKey)}
                      >
                        {showCheckbox && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {selectableInGroup.length > 0 && (
                              <input
                                type="checkbox"
                                checked={allGroupSelected}
                                onChange={() => toggleGroupCheckbox(row)}
                                className="h-4 w-4 rounded border-gray-300"
                              />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-sm">
                          <div className="flex items-center gap-1.5">
                            {!groupsCollapsed && (
                              isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-purple-600 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-purple-600 flex-shrink-0" />
                              )
                            )}
                            <span>{row.itemCode}</span>
                            <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-[10px]">
                              {row.items.length} serials
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate">
                          {row.description}
                        </TableCell>
                        <TableCell className="text-sm">{row.binNumber}</TableCell>
                        <TableCell className="text-right">{row.totalOnHand}</TableCell>
                        <TableCell className="text-right font-semibold">{row.totalCounted}</TableCell>
                        <TableCell className="text-right">
                          <VarianceBadge variance={row.totalVariance} isResolvedTab={isResolvedTab} />
                        </TableCell>
                        <TableCell className="text-right hidden md:table-cell text-sm">
                          R{Math.abs(row.totalVarianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="text-sm">{row.teamName}</TableCell>
                        <TableCell className="text-sm">
                          <div className="flex gap-1 flex-wrap">
                            {row.foundCount > 0 && (
                              <Badge className="bg-green-100 text-green-800 border-green-300 text-[10px]">
                                {row.foundCount} found
                              </Badge>
                            )}
                            {row.notFoundCount > 0 && (
                              <Badge className="bg-red-100 text-red-800 border-red-300 text-[10px]">
                                {row.notFoundCount} not found
                              </Badge>
                            )}
                            {row.unknownSerialCount > 0 && (
                              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px]">
                                {row.unknownSerialCount} unknown
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {showEditButton && <TableCell></TableCell>}
                      </TableRow>

                      {/* Expanded sub-rows */}
                      {isExpanded && row.items.map((v) => renderSubRow(v, rowProps))}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Render helpers for variance rows
interface RowProps {
  showEditButton: boolean;
  showCheckbox: boolean;
  showAcceptButton?: boolean;
  showReopenButton?: boolean;
  isResolvedTab?: boolean;
  onEdit?: (item: VarianceItem) => void;
  selectedCountIds?: Set<number>;
  onToggleSelect?: (countId: number) => void;
  canSelect?: (item: VarianceItem) => boolean;
  onAccept?: (action: AcceptAction, item: VarianceItem) => void;
  onAcceptVariance?: (item: VarianceItem) => void;
  onReopenVariance?: (item: VarianceItem) => void;
  onApproveUnknownSerial?: (item: VarianceItem) => void;
  onDismissUnknownSerial?: (item: VarianceItem) => void;
  onEditUnknownSerial?: (item: VarianceItem) => void;
  onSerialVerify?: (item: VarianceItem) => void;
  isSaving?: boolean;
  expandedComments?: Set<number>;
  onToggleComment?: (countId: number) => void;
}

function VarianceBadge({ variance, isResolvedTab }: { variance: number; isResolvedTab?: boolean }) {
  return !isResolvedTab ? (
    <Badge
      variant={Math.abs(variance) > 10 ? "destructive" : "outline"}
      className={Math.abs(variance) <= 10 ? "border-amber-400 text-amber-700" : ""}
    >
      {variance > 0 ? "+" : ""}{variance}
    </Badge>
  ) : (
    <Badge className="bg-green-100 text-green-800 border-green-300">
      {variance > 0 ? "+" : ""}{variance} Resolved
    </Badge>
  );
}

function SelectCell({ v, props }: { v: VarianceItem; props: RowProps }) {
  const { canSelect, selectedCountIds, onToggleSelect } = props;
  const isSelectable = canSelect ? canSelect(v) : false;
  const isSelected = selectedCountIds?.has(v.countId) ?? false;
  return (
    <TableCell>
      {isSelectable && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect?.(v.countId)}
          className="h-4 w-4 rounded border-gray-300"
        />
      )}
    </TableCell>
  );
}

function CommentToggle({ v, expanded, onToggleComment }: { v: VarianceItem; expanded: boolean; onToggleComment?: (countId: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggleComment?.(v.countId)}
      className={`inline-flex items-center justify-center h-5 w-5 rounded-full transition-colors ${
        expanded
          ? "bg-blue-100 text-blue-700"
          : "text-blue-400 hover:text-blue-600 hover:bg-blue-50"
      }`}
      title="View team note"
    >
      <MessageSquare className="h-3 w-3" />
    </button>
  );
}

function CommentNote({ comment }: { comment: string }) {
  return (
    <div className="mt-1.5 px-2 py-1.5 rounded-md bg-blue-50 border border-blue-200 text-xs text-blue-900 font-sans leading-relaxed max-w-[250px]">
      <div className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-0.5">Team Note</div>
      {comment}
    </div>
  );
}

/**
 * Contents of the "Verification" cell: unknown-serial status + discrepancy actions
 * (edit / assign verification / approve / dismiss), approved-serial edit, or the
 * count-verification status with Keep Original / Accept Verified.
 */
function VerificationStatus({ v, props, showOriginalLine }: { v: VarianceItem; props: RowProps; showOriginalLine: boolean }) {
  const { onAccept, onApproveUnknownSerial, onDismissUnknownSerial, onEditUnknownSerial, onSerialVerify, isSaving } = props;
  const hasVerification = !!v.verificationId;
  const isVerificationCompleted = v.verificationStatus === "completed";
  const isVerificationAccepted = v.verificationStatus === "accepted";
  const isVerificationPending = v.verificationStatus === "pending";
  const isUnknown = v.isUnknownSerial;

  return (
    <>
      {isUnknown && !v.isApprovedSerial && (
        <div className="space-y-1">
          {v.serialVerificationStatus === "completed" && v.serialVerificationResult ? (
            <Badge className={`text-xs ${v.serialVerificationResult === "confirmed" ? "bg-green-100 text-green-800 border-green-300" : "bg-red-100 text-red-800 border-red-300"}`}>
              {v.serialVerificationResult === "confirmed" ? "Confirmed Present" : "Not Found"}
            </Badge>
          ) : v.serialVerificationStatus === "pending" ? (
            <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs whitespace-nowrap">
              Verifying — {v.serialVerificationTeamName}
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">
              Unknown Serial
            </Badge>
          )}
          <div className="flex items-center gap-1">
            {onApproveUnknownSerial && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-1.5 text-blue-700 border-blue-300 hover:bg-blue-50"
                  onClick={() => onEditUnknownSerial?.(v)}
                  disabled={isSaving || v.serialVerificationStatus === "pending"}
                  title="Edit serial number"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                {v.serialVerificationStatus !== "pending" && onSerialVerify && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-1.5 text-purple-700 border-purple-300 hover:bg-purple-50"
                    onClick={() => onSerialVerify(v)}
                    disabled={isSaving}
                    title={v.serialVerificationStatus === "completed" ? "Re-assign verification" : "Assign verification"}
                  >
                    <ClipboardCheck className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-1.5 text-green-700 border-green-300 hover:bg-green-50"
                  onClick={() => onApproveUnknownSerial(v)}
                  disabled={isSaving || v.serialVerificationStatus === "pending"}
                  title="Approve serial"
                >
                  <Check className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-1.5 text-red-700 border-red-300 hover:bg-red-50"
                  onClick={() => onDismissUnknownSerial?.(v)}
                  disabled={isSaving || v.serialVerificationStatus === "pending"}
                  title="Dismiss serial"
                >
                  <XIcon className="h-3 w-3" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {v.isApprovedSerial && (
        <div className="space-y-1">
          <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
            Approved Serial
          </Badge>
          {onEditUnknownSerial && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-1.5 text-blue-700 border-blue-300 hover:bg-blue-50"
                onClick={() => onEditUnknownSerial(v)}
                disabled={isSaving}
                title="Edit serial number"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}
      {!isUnknown && !v.isApprovedSerial && !hasVerification && (
        <span className="text-muted-foreground">—</span>
      )}
      {!isUnknown && !v.isApprovedSerial && isVerificationPending && (
        <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs whitespace-nowrap">
          Pending — {v.verificationTeamName}
        </Badge>
      )}
      {!isUnknown && !v.isApprovedSerial && isVerificationCompleted && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-xs whitespace-nowrap">
              Verified: {v.verificationQty}
            </Badge>
            <span className="text-xs text-muted-foreground">
              by {v.verificationTeamName}
            </span>
          </div>
          {showOriginalLine && (
            <div className="text-[11px] text-muted-foreground">
              Original: {v.countedQty} → Verified: {v.verificationQty}
            </div>
          )}
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2.5"
              onClick={() => onAccept?.("accept_original", v)}
              disabled={isSaving}
            >
              Keep Original
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs px-2.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => onAccept?.("accept_verification", v)}
              disabled={isSaving}
            >
              Accept Verified
            </Button>
          </div>
        </div>
      )}
      {!isUnknown && !v.isApprovedSerial && isVerificationAccepted && (
        <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
          Verification Resolved
        </Badge>
      )}
    </>
  );
}

/** Last column: accept / reopen / edit buttons (not shown for serial rows). */
function RowActionsCell({ v, props }: { v: VarianceItem; props: RowProps }) {
  const { showAcceptButton, showReopenButton, onAcceptVariance, onReopenVariance, onEdit, isSaving } = props;
  return (
    <TableCell>
      {!v.isUnknownSerial && !v.isApprovedSerial && (
        <div className="flex items-center gap-1">
          {showAcceptButton && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2 text-green-700 border-green-300 hover:bg-green-50"
              onClick={() => onAcceptVariance?.(v)}
              disabled={isSaving}
              title="Accept variance"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          {showReopenButton && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2 text-amber-700 border-amber-300 hover:bg-amber-50"
              onClick={() => onReopenVariance?.(v)}
              disabled={isSaving}
              title="Reopen variance"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onEdit?.(v)}
          >
            Edit
          </Button>
        </div>
      )}
    </TableCell>
  );
}

function renderSingleRow(v: VarianceItem, props: RowProps) {
  const { showEditButton, showCheckbox, isResolvedTab, selectedCountIds, expandedComments, onToggleComment } = props;
  const commentExpanded = expandedComments?.has(v.countId) ?? false;
  const isSelected = selectedCountIds?.has(v.countId) ?? false;
  const isVerificationCompleted = v.verificationStatus === "completed";
  const isVerificationPending = v.verificationStatus === "pending";

  const rowBg = isSelected
    ? "bg-blue-50"
    : v.isUnknownSerial
      ? "bg-amber-50/50"
      : isVerificationCompleted
        ? "bg-purple-50/50"
        : isVerificationPending
          ? "bg-blue-50/50"
          : "";

  return (
    <TableRow key={v.countId} className={rowBg}>
      {showCheckbox && <SelectCell v={v} props={props} />}
      <TableCell className="font-mono text-sm">
        <div className="flex items-center gap-1">
          <span>{v.itemCode}</span>
          {v.comment && (
            <CommentToggle v={v} expanded={commentExpanded} onToggleComment={onToggleComment} />
          )}
        </div>
        {v.serialNumber && (
          <Badge className={`${v.isUnknownSerial ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-purple-100 text-purple-800 border-purple-300"} text-[10px] mt-0.5 font-mono`}>
            S/N: {v.serialNumber}
          </Badge>
        )}
        {commentExpanded && v.comment && <CommentNote comment={v.comment} />}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate">
        {v.description}
      </TableCell>
      <TableCell className="text-sm">{v.binNumber}</TableCell>
      <TableCell className="text-right">{v.onHand}</TableCell>
      <TableCell className="text-right font-semibold">{v.countedQty}</TableCell>
      <TableCell className="text-right">
        <VarianceBadge variance={v.variance} isResolvedTab={isResolvedTab} />
      </TableCell>
      <TableCell className="text-right hidden md:table-cell text-sm">
        R{Math.abs(v.varianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className="text-sm">{v.teamName}</TableCell>
      <TableCell className="text-sm">
        <VerificationStatus v={v} props={props} showOriginalLine />
      </TableCell>
      {showEditButton && <RowActionsCell v={v} props={props} />}
    </TableRow>
  );
}

function renderSubRow(v: VarianceItem, props: RowProps) {
  const { showEditButton, showCheckbox, isResolvedTab, selectedCountIds, expandedComments, onToggleComment } = props;
  const commentExpanded = expandedComments?.has(v.countId) ?? false;
  const isSelected = selectedCountIds?.has(v.countId) ?? false;
  const isUnknown = v.isUnknownSerial;
  const found = v.countedQty > 0;

  return (
    <TableRow
      key={v.countId}
      className={`${isSelected ? "bg-blue-50" : isUnknown ? "bg-amber-50/30" : "bg-purple-50/20"}`}
    >
      {showCheckbox && <SelectCell v={v} props={props} />}
      <TableCell className="font-mono text-sm pl-10">
        <div className="flex items-center gap-1">
          {v.serialNumber ? (
            <Badge className={`${isUnknown ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-purple-100 text-purple-800 border-purple-300"} text-[10px] font-mono`}>
              S/N: {v.serialNumber}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">No S/N</span>
          )}
          {v.comment && (
            <CommentToggle v={v} expanded={commentExpanded} onToggleComment={onToggleComment} />
          )}
        </div>
        {commentExpanded && v.comment && <CommentNote comment={v.comment} />}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm max-w-[200px] truncate text-muted-foreground">
        {isUnknown ? "Unknown serial" : found ? "Found" : "Not found"}
      </TableCell>
      <TableCell className="text-sm"></TableCell>
      <TableCell className="text-right">{v.onHand}</TableCell>
      <TableCell className="text-right font-semibold">{v.countedQty}</TableCell>
      <TableCell className="text-right">
        <VarianceBadge variance={v.variance} isResolvedTab={isResolvedTab} />
      </TableCell>
      <TableCell className="text-right hidden md:table-cell text-sm">
        R{Math.abs(v.varianceValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </TableCell>
      <TableCell className="text-sm"></TableCell>
      <TableCell className="text-sm">
        <VerificationStatus v={v} props={props} showOriginalLine={false} />
      </TableCell>
      {showEditButton && <RowActionsCell v={v} props={props} />}
    </TableRow>
  );
}
