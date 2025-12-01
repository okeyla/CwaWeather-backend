require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 2000;

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 取得指定城市天氣預報
 * CWA 氣象資料開放平臺 API
 * 使用「一般天氣預報-今明 36 小時天氣預報」資料集
 */
const getCityWeather = async (req, res) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 500;

  // 內部函數:嘗試獲取天氣資料
  const fetchWeatherData = async (cityName, retryCount = 0) => {
    try {
      // 添加延遲避免觸發 WAF
      const delay = retryCount > 0 ? RETRY_DELAY : 100;
      if (retryCount > 0) {
        console.log(`⏳ 重試 ${retryCount}/${MAX_RETRIES}，延遲 ${delay}ms...`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));

      console.log(`🌐 [嘗試 ${retryCount + 1}] 請求 CWA API:`, cityName);

      // 呼叫 CWA API
      const response = await axios.get(
        `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`,
        {
          params: {
            Authorization: CWA_API_KEY,
            locationName: cityName,
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'zh-TW,zh;q=0.9',
            'Referer': 'https://opendata.cwa.gov.tw/',
          },
          timeout: 10000,
        }
      );

      console.log('📡 Status:', response.status, 'Content-Type:', response.headers['content-type']);

      // 檢查是否收到 HTML 錯誤頁面 (WAF 拒絕)
      const contentType = response.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        console.error('❌ 收到 HTML 而非 JSON (WAF 拒絕)');
        if (retryCount < MAX_RETRIES) {
          throw new Error('WAF 拒絕請求');
        }
        return null;
      }

      // 檢查必要的資料結構
      if (!response.data || !response.data.records || !response.data.records.location) {
        console.error('❌ API 回應結構異常');
        if (retryCount < MAX_RETRIES) {
          throw new Error('API 回應結構異常');
        }
        return null;
      }

      console.log('✅ 成功獲取資料');
      return response.data;

    } catch (error) {
      console.error(`❌ [嘗試 ${retryCount + 1}] 錯誤:`, error.message);

      if (retryCount < MAX_RETRIES) {
        return fetchWeatherData(cityName, retryCount + 1);
      }

      throw error;
    }
  };

  try {
    const cityName = req.params.city || req.query.city || "臺北市";

    if (!CWA_API_KEY) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: "請在 .env 檔案中設定 CWA_API_KEY",
      });
    }

    // 嘗試獲取天氣資料(帶重試)
    const data = await fetchWeatherData(cityName);

    if (!data) {
      return res.status(500).json({
        error: "API 回應格式錯誤",
        message: "CWA API 回應的資料格式不符合預期",
      });
    }

    const locationData = data.records.location[0];

    if (!locationData) {
      return res.status(404).json({
        error: "查無資料",
        message: `無法取得${cityName}天氣資料`,
      });
    }

    console.log('✅ 成功取得天氣資料:', locationData.locationName);

    // 整理天氣資料
    const weatherData = {
      city: locationData.locationName,
      updateTime: data.records.datasetDescription,
      forecasts: [],
    };

    const weatherElements = locationData.weatherElement;
    const timeCount = weatherElements[0].time.length;

    for (let i = 0; i < timeCount; i++) {
      const forecast = {
        startTime: weatherElements[0].time[i].startTime,
        endTime: weatherElements[0].time[i].endTime,
        weather: "",
        rain: "",
        minTemp: "",
        maxTemp: "",
        comfort: "",
        windSpeed: "",
      };

      weatherElements.forEach((element) => {
        const value = element.time[i].parameter;
        switch (element.elementName) {
          case "Wx":
            forecast.weather = value.parameterName;
            break;
          case "PoP":
            forecast.rain = value.parameterName + "%";
            break;
          case "MinT":
            forecast.minTemp = value.parameterName + "°C";
            break;
          case "MaxT":
            forecast.maxTemp = value.parameterName + "°C";
            break;
          case "CI":
            forecast.comfort = value.parameterName;
            break;
          case "WS":
            forecast.windSpeed = value.parameterName;
            break;
        }
      });

      weatherData.forecasts.push(forecast);
    }

    res.json({
      success: true,
      data: weatherData,
    });
  } catch (error) {
    console.error("❌ 取得天氣資料失敗:", error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        error: "CWA API 錯誤",
        message: error.response.data.message || "無法取得天氣資料",
      });
    }

    res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "歡迎使用 CWA 天氣預報 API",
    endpoints: {
      weather: "/api/weather/:city",
      health: "/api/health",
    },
    availableCities: [
      "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
      "基隆市", "新竹市", "嘉義市", "新竹縣", "苗栗縣", "彰化縣",
      "南投縣", "雲林縣", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
      "臺東縣", "澎湖縣", "金門縣", "連江縣"
    ]
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.get("/api/weather/:city", getCityWeather);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "伺服器錯誤",
    message: err.message,
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "找不到此路徑",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 伺服器運行在 port ${PORT}`);
  console.log(`📍 環境: ${process.env.NODE_ENV || "development"}`);
});
