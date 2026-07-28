export default async function handler(req, res) {
  // CORS 및 HTTP 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Preflight OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 대시보드의 Environment Variables 설정에서 GEMINI_API_KEY를 설정해 주세요.' 
    });
  }

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: '분석할 이미지 데이터가 전송되지 않았습니다.' });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const promptText = `당신은 학교 급식 및 영양 식단 전문 임상영양사입니다. 
제공된 급식/음식 사진을 정밀하게 분석하여 다음 지침에 따라 영양 정보를 반환하세요:
1. 사진 속에 포함된 각 메뉴/음식의 이름, 추정 분량, 칼로리를 구별하세요.
2. 식단 전체의 총 칼로리(kcal)를 계산하세요.
3. 3대 영양소 (탄수화물 g, 단백질 g, 지방 g) 및 나트륨(mg) 함량을 추정하세요.
4. 급식의 영양 균형 점수를 100점 만점 기준으로 평가하세요.
5. 전체적인 급식 총평 한줄과 실천하기 좋은 영양 가이드 팁 3가지를 작성하세요.
6. 모든 답변은 지정된 JSON 구조 형식으로만 반환하세요.`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            mealName: { type: 'STRING', description: '급식 대표 이름 (예: 한식 불고기 급식)' },
            totalCalories: { type: 'NUMBER', description: '총 칼로리 (kcal)' },
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING', description: '음식명' },
                  portion: { type: 'STRING', description: '추정 분량 (예: 1공기, 150g, 1대접)' },
                  calories: { type: 'NUMBER', description: '해당 음식 칼로리 (kcal)' },
                  category: { type: 'STRING', description: '구분 (주식, 국/찌개, 메인반찬, 찬류, 후식)' }
                },
                required: ['name', 'calories']
              }
            },
            macros: {
              type: 'OBJECT',
              properties: {
                carbs: { type: 'NUMBER', description: '탄수화물 (g)' },
                protein: { type: 'NUMBER', description: '단백질 (g)' },
                fat: { type: 'NUMBER', description: '지방 (g)' },
                sodium: { type: 'NUMBER', description: '나트륨 (mg)' }
              },
              required: ['carbs', 'protein', 'fat', 'sodium']
            },
            nutritionScore: { type: 'NUMBER', description: '영양 균형 점수 (1~100)' },
            summary: { type: 'STRING', description: '식단 영양 요약 한줄평' },
            advice: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: '영양사 팁 및 건강 가이드 메시지 리스트'
            }
          },
          required: ['totalCalories', 'items', 'macros', 'nutritionScore', 'summary', 'advice']
        }
      }
    };

    let response;
    let retries = 0;
    const maxRetries = 3;
    let delay = 1000;

    while (retries < maxRetries) {
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (response.ok) break;
      } catch (err) {
        console.warn(`Gemini API connection attempt ${retries + 1} failed:`, err);
      }
      retries++;
      if (retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    if (!response || !response.ok) {
      const errorText = response ? await response.text() : 'API 통신 장애';
      console.error('Gemini API Error details:', errorText);
      return res.status(500).json({ error: `Gemini API 호출에 실패했습니다 (${response ? response.status : 'Network error'})` });
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];
    const textContent = candidate?.content?.parts?.[0]?.text;

    if (!textContent) {
      return res.status(500).json({ error: 'Gemini 모델 응답에서 데이터 분석 결과를 파싱할 수 없습니다.' });
    }

    const parsedData = JSON.parse(textContent);
    return res.status(200).json({ success: true, data: parsedData });

  } catch (error) {
    console.error('Serverless Function Handler Exception:', error);
    return res.status(500).json({ error: `서버 내부 오류: ${error.message}` });
  }
}