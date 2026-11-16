/**
 * 기존 Google Workspace 조직도 시트 갱신 + 래비 월별 현원 동기화.
 * Script Properties에 아래 두 값을 먼저 등록하세요.
 * - RAEBI_SYNC_URL: https://cmslab-chat.vercel.app/api/integrations/google-directory
 * - RAEBI_SYNC_SECRET: Vercel의 GOOGLE_DIRECTORY_SYNC_SECRET와 같은 값
 */
function updateWorkspaceUsersToSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const headers = ['이름', '이메일', '부서(OU)', '상태'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const userRows = [];
  let pageToken;
  do {
    const page = AdminDirectory.Users.list({
      customer: 'my_customer',
      maxResults: 500,
      pageToken,
      orderBy: 'givenName'
    });
    for (const user of page.users || []) {
      userRows.push([
        user.name && user.name.fullName || '',
        user.primaryEmail || '',
        user.orgUnitPath || '/',
        user.suspended || user.archived ? '중지됨' : '활성'
      ]);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  if (userRows.length) sheet.getRange(2, 1, userRows.length, 4).setValues(userRows);

  const now = new Date();
  const displayTime = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  sheet.getRange('E1').setValue('최근 업데이트: ' + displayTime);
  syncHeadcountToRaebi_(userRows, now);
}

function syncHeadcountToRaebi_(userRows, now) {
  const properties = PropertiesService.getScriptProperties();
  const url = properties.getProperty('RAEBI_SYNC_URL');
  const secret = properties.getProperty('RAEBI_SYNC_SECRET');
  if (!url || !secret) throw new Error('RAEBI_SYNC_URL과 RAEBI_SYNC_SECRET을 Script Properties에 등록해 주세요.');

  const counts = {};
  let totalActive = 0;
  for (const row of userRows) {
    if (row[3] !== '활성') continue;
    const path = String(row[2] || '/미분류').trim();
    counts[path] = (counts[path] || 0) + 1;
    totalActive += 1;
  }

  const payload = {
    snapshotMonth: Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-01'),
    snapshotAt: now.toISOString(),
    totalActive,
    orgUnits: Object.keys(counts).sort().map(path => ({ path, count: counts[path] }))
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('래비 조직도 동기화 실패: HTTP ' + response.getResponseCode());
  }
}

/** 한 번 실행하면 매월 1일 새벽에 자동 갱신됩니다. */
function createMonthlyWorkspaceSyncTrigger() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'updateWorkspaceUsersToSheet') ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('updateWorkspaceUsersToSheet')
    .timeBased()
    .onMonthDay(1)
    .atHour(4)
    .create();
}
