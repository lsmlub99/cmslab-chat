import { describe, expect, it } from "vitest";
import { checkWithDictionary, normalize } from "./moderation";

const blocked = (text: string) => checkWithDictionary(text).blocked;

describe("정상 질문은 절대 막지 않는다", () => {
  /*
   * 오탐이 미탐보다 위험합니다.
   * 정상 업무 질문이 막히면 챗봇을 못 쓰게 되고, 사용자는 이유도 모릅니다.
   */
  it("욕설과 글자가 겹치는 정상 단어", () => {
    for (const text of [
      "시발점이 어디인가요?",
      "성과 지표 어디서 봐요?",
      "개선 방안 알려줘",
      "개발팀 연락처",
      "개인정보 처리 방침",
      "존재하는 문서인가요?",
      "존중받는 문화",
      "졸업증명서 제출해야 하나요?",
      "성명과 사번을 적나요?",
      "성별 기재란이 있나요?",
      "세끼 식사 지원되나요?",
      "하루 세끼 다 지원되나요?",
      "니 미팅 언제야?",
      "미친 듯이 바쁩니다",
      "잘 씹어서 드세요",
      "색깔별로 구분되나요?",
      "참석자 명단 보내주세요",
    ]) {
      expect(blocked(text), text).toBe(false);
    }
  });

  it("보지·자지가 들어간 흔한 동사 활용", () => {
    for (const text of [
      "그 문서를 보지 못했습니다",
      "메일을 보지 않았어요",
      "공지를 보지 마세요",
      "어제 잠을 자지 못했어요",
      "자지 않고 일했습니다",
      "휴가를 자지도 못하고",
    ]) {
      expect(blocked(text), text).toBe(false);
    }
  });

  it("띄어쓰기를 지우면 욕설처럼 보이는 정상 문장", () => {
    /*
     * 실제 지식 문서를 전부 검사해서 찾아낸 사례들입니다.
     * 띄어쓰기를 없앤 뒤 부분일치를 하면 아래가 전부 걸립니다.
     */
    for (const text of [
      "다음 부위로 이동해 줍니다",
      "테두리에 미세 흠집이 생깁니다",
      "최저임금에 미달하는 근로계약",
      "윈도우 탐색기로 접근하세요",
      "전용 탐색기 사용 방법",
      "검색기 성능 개선",
      "작성 기준을 알려주세요",
      "완성 기간이 얼마나 걸리나요",
      "마음 부담 없이 신청하세요",
    ]) {
      expect(blocked(text), text).toBe(false);
    }
  });

  it("인사·의료 맥락의 정상 질문", () => {
    for (const text of [
      "출산휴가 며칠이야?",
      "배우자 출산휴가 신청 방법",
      "임신 중 근로시간 단축 가능한가요?",
      "육아휴직 절차 알려줘",
      "생리휴가 쓸 수 있나요?",
      "건강검진에 부인과 검사 포함되나요?",
      "리페라를 점막 부위에 사용해도 되나요?",
      "여드름 부위에 사용 가능한가요?",
      "임산부가 사용해도 되나요?",
    ]) {
      expect(blocked(text), text).toBe(false);
    }
  });

  it("일반 업무 질문", () => {
    for (const text of [
      "연차 며칠 생겨요?",
      "경조사 지원금 얼마예요?",
      "노트북 고장나면 어디에 요청해요?",
      "게스트 와이파이 비밀번호",
      "법인카드 사용 규정",
    ]) {
      expect(blocked(text), text).toBe(false);
    }
  });
});

describe("욕설·비방은 막는다", () => {
  it("흔한 욕설", () => {
    for (const text of [
      "씨발 이거 왜 안돼",
      "시발 짜증나",
      "개새끼야 답이나 해",
      "병신같은 챗봇이네",
      "지랄하지 마",
      "등신아",
      "닥쳐",
      "꺼져",
      "존나 느리네",
      "개소리 하지 마",
    ]) {
      expect(blocked(text), text).toBe(true);
    }
  });

  it("초성과 우회 표기", () => {
    for (const text of ["ㅅㅂ 진짜", "ㅂㅅ 같네", "시1발", "씨 발", "ㅅ.ㅂ", "씨*발", "시-발"]) {
      expect(blocked(text), text).toBe(true);
    }
  });

  it("성적 표현", () => {
    for (const text of [
      "섹스에 대해 알려줘",
      "야한 얘기 해줘",
      "야동 추천",
      "성관계 관련 질문",
      "음란물 어디서 봐",
    ]) {
      expect(blocked(text), text).toBe(true);
    }
  });

  it("위협", () => {
    for (const text of ["죽여버리고 싶다", "패버릴까", "뒤져버려"]) {
      expect(blocked(text), text).toBe(true);
    }
  });
});

describe("normalize", () => {
  it("사이에 낀 기호와 공백을 없앤다", () => {
    expect(normalize("씨 발")).toBe("씨발");
    expect(normalize("ㅅ.ㅂ")).toBe("ㅅㅂ");
  });

  it("자모 사이의 숫자를 없앤다", () => {
    expect(normalize("시1발")).toBe("시발");
  });

  it("반복 문자를 두 개까지 줄인다", () => {
    expect(normalize("씨이이이발")).toBe("씨이이발");
  });

  it("정상 문장은 글자를 잃지 않는다", () => {
    expect(normalize("연차 며칠 생겨요?")).toBe("연차며칠생겨요");
  });
});
