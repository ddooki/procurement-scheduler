# 프로젝트 비즈니스 규칙 (Business Rules)

## 영업일 (Business Day) 정의 및 처리 규칙
사용자가 **"영업일"**을언급하거나 관련 로직을 적용할 때 다음 규칙을 엄격히 준수합니다:

1. **영업일(Business Day) 조건**:
   - 주말 (토요일, 일요일) **제외**
   - 아래의 휴일/연차 관련 일정 타입(TaskType)이 지정된 날짜 **제외**:
     - `HOLIDAY` (휴일)
     - `COMPANY_HOLIDAY` (지정연차)
     - `PERSONAL_LEAVE` (연차/휴가)

2. **코드 구현 위치 및 헬퍼 함수**:
   - `app/page.tsx` 내 `isBusinessDay(date, tasks)` 및 `countBusinessDaysBetween(start, end, tasks)`
   - 날짜 범위(startDate ~ endDate)에 걸쳐있는 연차/휴일 일정을 파악하여 정확한 영업일수를 계산합니다.
