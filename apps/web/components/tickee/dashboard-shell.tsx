"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_RETURN_TO,
  ErrorCode,
  organizationDashboardPath,
} from "@tickee/contracts";
import { ShieldX } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import { hasErrorCode } from "@/lib/auth/api";
import { LOGIN_PATH, withReturnTo } from "@/lib/auth/return-to";
import {
  fetchMemberships,
  fetchOrganization,
  MEMBERSHIPS_QUERY_KEY,
  organizationQueryKey,
} from "@/lib/organizer/api";
import { activeSection } from "@/lib/organizer/nav";
import { cn } from "@/lib/utils";

import { BottomTabBar } from "./bottom-tab-bar";
import { CurrentOrganizationProvider } from "./current-organization";
import { DashboardSidebar } from "./dashboard-sidebar";
import { EmptyState } from "./empty-state";
import { RemovedFromOrganizationDialog } from "./removed-from-organization-dialog";
import { SiteHeader } from "./site-header";
import { StatusBanner } from "./status-banner";
import { StatusBannerStack } from "./status-banner-stack";

const MAIN_ID = "noi-dung";

/** Link đầu tiên của trang (WCAG 2.4.1): bỏ qua switcher, sidebar và header, tới thẳng `<main>`. Chỉ hiện khi focus. */
function SkipToContent() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:shadow-card"
    >
      Bỏ qua đến nội dung
    </a>
  );
}

/**
 * Vùng nội dung. Có tab bar (< `md`) thì chừa đáy bằng chiều cao tab bar + safe-area + khoảng `section`, để phần
 * cuối trang không bị tab bar che. `banners` (dải `status-banner`) nằm ở đầu `<main>`, trên nội dung trang.
 */
function ContentColumn({
  withTabBar,
  banners,
  children,
}: {
  withTabBar: boolean;
  banners?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col px-gutter-mobile md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <SiteHeader />
        <main
          id={MAIN_ID}
          tabIndex={-1}
          className={cn(
            "flex-1",
            withTabBar
              ? "pb-[calc(var(--spacing-tab-bar-height)+env(safe-area-inset-bottom)+var(--spacing-section))] md:pb-section"
              : "pb-section",
          )}
        >
          {banners}
          {children}
        </main>
      </div>
    </div>
  );
}

function LoadingContent() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col gap-section pt-2"
    >
      <span className="sr-only">Đang tải</span>
      <div
        aria-hidden="true"
        className="h-9 w-2/3 animate-pulse rounded-md bg-muted"
      />
      <div
        aria-hidden="true"
        className="h-32 animate-pulse rounded-lg bg-muted"
      />
    </div>
  );
}

/**
 * Bị xóa khỏi BTC giữa phiên: BTC `orgId` đã tải xong (`loaded`) mà sau đó một request bất kỳ (query hay mutation)
 * nhận `NOT_A_MEMBER`. Trong dashboard một BTC, mọi request BTC đều thuộc BTC đó. Mở BTC lần đầu đã không có quyền
 * thì không tính (giữ `empty-state`).
 */
function useRemovedMidSession(orgId: string, loaded: boolean): boolean {
  const queryClient = useQueryClient();
  const [removedFrom, setRemovedFrom] = useState<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const flag = (error: unknown) => {
      if (hasErrorCode(error, ErrorCode.NOT_A_MEMBER)) setRemovedFrom(orgId);
    };
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error")
        flag(event.action.error);
    });
    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error")
        flag(event.action.error);
    });
    return () => {
      offQueries();
      offMutations();
    };
  }, [loaded, orgId, queryClient]);
  return removedFrom === orgId;
}

/**
 * Khung dashboard của một BTC (UX-DR34). Tải BTC (vai lấy từ `GET /v1/orgs/:orgId`, guard api là nguồn sự thật) và
 * memberships (cho BTC switcher), rồi bọc trang con bằng sidebar (≥ `md`) hoặc `bottom-tab-bar` (< `md`), với dải
 * `status-banner` (thông báo trạng thái của BTC, UX-DR8) ở đầu vùng nội dung.
 * 401 → đăng nhập kèm `returnTo` là trang hiện tại; `NOT_A_MEMBER` khi mở BTC → `empty-state`, không render điều
 * hướng. `NOT_A_MEMBER` sau khi BTC đã tải (bị xóa giữa phiên) → `Dialog` không đóng được, "Đồng ý" chuyển sang BTC
 * đầu tiên còn lại, không còn BTC nào thì về trang chủ.
 */
export function DashboardShell({
  orgId,
  children,
}: {
  orgId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const org = useQuery({
    queryKey: organizationQueryKey(orgId),
    queryFn: ({ signal }) => fetchOrganization(orgId, signal),
  });
  const memberships = useQuery({
    queryKey: MEMBERSHIPS_QUERY_KEY,
    queryFn: ({ signal }) => fetchMemberships(signal),
    // Tải được BTC nghĩa là đã đăng nhập và đã đồng ý NĐ 13.
    enabled: org.isSuccess,
  });

  const notAMember = hasErrorCode(org.error, ErrorCode.NOT_A_MEMBER);
  const removedMidSession = useRemovedMidSession(orgId, org.data !== undefined);
  const removed =
    removedMidSession || (org.data !== undefined && notAMember);
  const [leavingFrom, setLeavingFrom] = useState<string | null>(null);
  const leaving = leavingFrom === orgId;

  useEffect(() => {
    if (!removed) return;
    // Rời trang rồi mới bỏ BTC khỏi cache: quay lại BTC này thì tải lại (và thấy `empty-state`) thay vì dữ liệu cũ.
    return () =>
      queryClient.removeQueries({
        queryKey: organizationQueryKey(orgId),
        exact: true,
      });
  }, [removed, orgId, queryClient]);

  /** "Đồng ý": tải lại danh sách BTC (đã không còn BTC này) rồi sang BTC đầu tiên, không còn thì về trang chủ. */
  const leave = async () => {
    if (leaving) return;
    setLeavingFrom(orgId);
    let target = DEFAULT_RETURN_TO;
    try {
      const list = await queryClient.fetchQuery({
        queryKey: MEMBERSHIPS_QUERY_KEY,
        queryFn: ({ signal }) => fetchMemberships(signal),
        staleTime: 0,
      });
      const next = list.find(
        (m) => m.organizationId.toLowerCase() !== orgId.toLowerCase(),
      );
      if (next) target = organizationDashboardPath(next.organizationId);
    } catch {
      // Không tải được danh sách: về trang chủ.
    }
    router.replace(target);
  };

  const unauthenticated = hasErrorCode(org.error, ErrorCode.UNAUTHENTICATED);
  useEffect(() => {
    if (!unauthenticated) return;
    // Bỏ BTC khỏi cache: nếu 401 đến lúc tải lại nền (đã có data), TanStack Query giữ lỗi đó suốt lần refetch khi quay
    // lại sau đăng nhập, và trang sẽ bị đẩy về đăng nhập lần nữa.
    queryClient.removeQueries({ queryKey: organizationQueryKey(orgId) });
    // Giữ cả query và hash như `Providers`.
    router.replace(
      withReturnTo(
        LOGIN_PATH,
        `${pathname}${window.location.search}${window.location.hash}`,
      ),
    );
  }, [unauthenticated, pathname, router, queryClient, orgId]);

  // 401 chuyển sang đăng nhập ở effect trên; CONSENT_REQUIRED do `Providers` chuyển sang màn đồng ý. TOTP_REQUIRED
  // thì `Providers` mở dialog "Xác thực hai lớp" tại chỗ (dưới dialog là banner lỗi + "Thử lại"); qua lớp hai thì
  // query BTC tự tải lại. Không ai bị buộc bật 2FA nên không có nhánh chuyển sang màn đăng ký.
  const redirecting =
    unauthenticated || hasErrorCode(org.error, ErrorCode.CONSENT_REQUIRED);
  if (org.isPending || redirecting) {
    return (
      <div className="flex min-h-dvh">
        {/* Giữ chỗ sidebar để nội dung không nhảy khi điều hướng hiện ra. */}
        <div
          aria-hidden="true"
          className="hidden w-16 shrink-0 bg-stage md:block lg:w-sidebar-width"
        />
        <ContentColumn withTabBar={false}>
          <LoadingContent />
        </ContentColumn>
      </div>
    );
  }

  // Lỗi khi tải lại nền (đã có dữ liệu) thì giữ khung; NOT_A_MEMBER lúc đó là bị xóa giữa phiên (Dialog bên dưới).
  if (!org.data) {
    return (
      <ContentColumn withTabBar={false}>
        {notAMember ? (
          <EmptyState
            icon={ShieldX}
            title="Bạn không có quyền xem BTC này."
            description="Kiểm tra lại đường link, hoặc mở BTC của bạn từ menu tài khoản."
          />
        ) : (
          <div className="pt-2">
            <StatusBanner
              tone="danger"
              title="Chưa tải được BTC"
              description={
                org.error instanceof ApiError
                  ? org.error.message
                  : "Vui lòng thử lại."
              }
              action={
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => void org.refetch()}
                >
                  Thử lại
                </Button>
              }
            />
          </div>
        )}
      </ContentColumn>
    );
  }

  const organization = org.data;
  const membershipsState = {
    data: memberships.data,
    isError: memberships.isError,
  };
  // So với `orgId` của URL (cùng dạng với pathname), không với id api trả về.
  const active = activeSection(orgId, pathname);

  return (
    <CurrentOrganizationProvider value={organization}>
      <SkipToContent />
      <div className="flex min-h-dvh">
        <DashboardSidebar
          organization={organization}
          memberships={membershipsState}
          active={active}
        />
        <ContentColumn
          withTabBar
          banners={<StatusBannerStack orgId={orgId} />}
        >
          {children}
        </ContentColumn>
        <BottomTabBar
          organization={organization}
          memberships={membershipsState}
          active={active}
        />
      </div>
      <RemovedFromOrganizationDialog
        open={removed}
        organizationName={organization.name}
        leaving={leaving}
        onConfirm={() => void leave()}
      />
    </CurrentOrganizationProvider>
  );
}
