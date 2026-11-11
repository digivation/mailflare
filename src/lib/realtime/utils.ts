import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxAccess, mailboxes, users } from "@/db/schema";
import { hasMailboxPermission } from "@/lib/mailboxes/access";
import type { NewMessageNotification, AgentDraftNotification } from "./types";
import { sendPushNotifications } from "@/lib/push/server";
import { sendNativePush } from "@/lib/push/native";

const notificationRecipientBatchSize = 90;

export function getSessionTokenFromRequest(request: Request): string | undefined {
	const cookie = request.headers.get("Cookie");
	if (!cookie) return undefined;

	for (const part of cookie.split(";")) {
		const [name, ...valueParts] = part.trim().split("=");
		if (name === "ep_session") {
			const value = valueParts.join("=");
			return value ? decodeURIComponent(value) : undefined;
		}
	}

	return undefined;
}

export async function getMailboxNotificationUserIds(
	env: CloudflareEnv,
	mailboxId: string,
	ownerUserId: string,
): Promise<string[]> {
	const db = getDb(env);
	const mailboxRows = await db
		.select({ domainOwnerUserId: domains.userId, type: mailboxes.type, disabled: mailboxes.disabled })
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.where(eq(mailboxes.id, mailboxId))
		.limit(1);
	const mailbox = mailboxRows[0];
	if (!mailbox || mailbox.disabled) return [];
	const sharedUserIds = mailbox.type === "shared"
		? (await db
			.select({ userId: mailboxAccess.userId, permission: mailboxAccess.permission })
			.from(mailboxAccess)
			.where(eq(mailboxAccess.mailboxId, mailboxId)))
			.filter((access) => hasMailboxPermission(access.permission, "read_only"))
			.map((access) => access.userId)
		: [];
	const recipientIds = [...new Set([ownerUserId, mailbox.domainOwnerUserId, ...sharedUserIds].filter((id): id is string => !!id))];
	if (!recipientIds.length) return [];
	const activeUserIds: string[] = [];
	// Leave room below D1's 100-parameter limit for the active-account filters.
	for (let index = 0; index < recipientIds.length; index += notificationRecipientBatchSize) {
		const batch = recipientIds.slice(index, index + notificationRecipientBatchSize);
		activeUserIds.push(...(await db
			.select({ id: users.id })
			.from(users)
			.where(and(inArray(users.id, batch), eq(users.disabled, false), isNull(users.deletedAt))))
			.map((user) => user.id));
	}
	return activeUserIds;
}

export async function notifyUsersOfNewMessage(
	env: CloudflareEnv,
	userIds: string[],
	payload: NewMessageNotification | AgentDraftNotification,
): Promise<void> {
	// Next dev uses a bindings-only proxy; realtime delivery runs in worker.ts.
	if (!env.REALTIME) return;
	const results = await Promise.allSettled([
		...userIds.map((userId) => {
			const hub = env.REALTIME.getByName(userId);
			return hub.fetch("https://mailflare-realtime/notify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
		}),
		...(payload.type === "agent_draft" ? [] : Array.from(
			{ length: Math.ceil(userIds.length / notificationRecipientBatchSize) },
			(_, index) => userIds.slice(index * notificationRecipientBatchSize, (index + 1) * notificationRecipientBatchSize),
		).flatMap((batch) => [sendPushNotifications(env, batch, payload), sendNativePush(env, batch, payload)])),
	]);
	for (const result of results) {
		if (result.status === "rejected") console.error("New-message notification failed", result.reason);
	}
}
