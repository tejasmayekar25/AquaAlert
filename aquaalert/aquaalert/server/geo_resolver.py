"""
Geo-resolver module for Indian cities and regional locations.
Resolves GPS coordinates (lat, lon) to the nearest city, district, or geographic basin.
"""

from __future__ import annotations
import math
from typing import Sequence
import numpy as np

# Curated list of major Indian cities, district centers, and regional hubs
# Format: (City, State / Region, Latitude, Longitude)
MAJOR_INDIAN_CITIES: list[tuple[str, str, float, float]] = [
    # ── Delhi NCR & Northern Plains ───────────────────────────────────────────
    ("New Delhi", "Delhi NCR", 28.6139, 77.2090),
    ("Noida", "Delhi NCR (UP)", 28.5355, 77.3910),
    ("Greater Noida", "Uttar Pradesh", 28.4744, 77.5040),
    ("Ghaziabad", "Delhi NCR (UP)", 28.6692, 77.4538),
    ("Gurugram", "Delhi NCR (HR)", 28.4595, 77.0266),
    ("Faridabad", "Delhi NCR (HR)", 28.4089, 77.3178),
    ("Sonipat", "Haryana", 28.9931, 77.0151),
    ("Panipat", "Haryana", 29.3909, 76.9635),
    ("Karnal", "Haryana", 29.6857, 76.9905),
    ("Ambala", "Haryana", 30.3782, 76.7767),
    ("Hisar", "Haryana", 29.1492, 75.7217),
    ("Rohtak", "Haryana", 28.8955, 76.6066),
    ("Rewari", "Haryana", 28.1833, 76.6167),
    ("Bhiwani", "Haryana", 28.7932, 76.1390),
    ("Sirsa", "Haryana", 29.5349, 75.0298),

    # ── Uttar Pradesh ─────────────────────────────────────────────────────────
    ("Bareilly", "Uttar Pradesh", 28.3670, 79.4304),
    ("Lucknow", "Uttar Pradesh", 26.8467, 80.9462),
    ("Kanpur", "Uttar Pradesh", 26.4499, 80.3319),
    ("Agra", "Uttar Pradesh", 27.1767, 78.0081),
    ("Varanasi", "Uttar Pradesh", 25.3176, 82.9739),
    ("Prayagraj", "Uttar Pradesh", 25.4358, 81.8463),
    ("Meerut", "Uttar Pradesh", 28.9845, 77.7064),
    ("Aligarh", "Uttar Pradesh", 27.8974, 78.0880),
    ("Moradabad", "Uttar Pradesh", 28.8386, 78.7733),
    ("Saharanpur", "Uttar Pradesh", 29.9640, 77.5460),
    ("Gorakhpur", "Uttar Pradesh", 26.7606, 83.3732),
    ("Jhansi", "Uttar Pradesh", 25.4484, 78.5685),
    ("Mathura", "Uttar Pradesh", 27.4924, 77.6737),
    ("Ayodhya", "Uttar Pradesh", 26.7922, 82.1998),
    ("Muzaffarnagar", "Uttar Pradesh", 29.4727, 77.7085),
    ("Shahjahanpur", "Uttar Pradesh", 27.8804, 79.9149),
    ("Firozabad", "Uttar Pradesh", 27.1591, 78.3957),
    ("Budaun", "Uttar Pradesh", 28.0334, 79.1235),
    ("Rampur", "Uttar Pradesh", 28.8154, 79.0257),
    ("Sitapur", "Uttar Pradesh", 27.5684, 80.6829),
    ("Lakhimpur", "Uttar Pradesh", 27.9462, 80.7788),
    ("Pilibhit", "Uttar Pradesh", 28.6310, 79.8055),
    ("Hardoi", "Uttar Pradesh", 27.3948, 80.1293),
    ("Unnao", "Uttar Pradesh", 26.5458, 80.4878),
    ("Rae Bareli", "Uttar Pradesh", 26.2303, 81.2409),
    ("Bahraich", "Uttar Pradesh", 27.5744, 81.5976),
    ("Gonda", "Uttar Pradesh", 27.1332, 81.9619),
    ("Basti", "Uttar Pradesh", 26.8058, 82.7629),
    ("Deoria", "Uttar Pradesh", 26.5023, 83.7791),
    ("Azamgarh", "Uttar Pradesh", 26.0683, 83.1837),
    ("Jaunpur", "Uttar Pradesh", 25.7464, 82.6837),
    ("Ballia", "Uttar Pradesh", 25.7600, 84.1500),
    ("Mirzapur", "Uttar Pradesh", 25.1460, 82.5685),
    ("Sonbhadra", "Uttar Pradesh", 24.6850, 83.0650),
    ("Banda", "Uttar Pradesh", 25.4800, 80.3400),
    ("Bulandshahr", "Uttar Pradesh", 28.4069, 77.8498),
    ("Bijnor", "Uttar Pradesh", 29.3732, 78.1354),
    ("Amroha", "Uttar Pradesh", 28.9044, 78.4684),
    ("Hapur", "Uttar Pradesh", 28.7306, 77.7759),
    ("Mainpuri", "Uttar Pradesh", 27.2276, 79.0264),
    ("Etawah", "Uttar Pradesh", 26.7855, 79.0154),
    ("Farrukhabad", "Uttar Pradesh", 27.3826, 79.5843),

    # ── Uttarakhand & Himachal Pradesh ────────────────────────────────────────
    ("Dehradun", "Uttarakhand", 30.3165, 78.0322),
    ("Haridwar", "Uttarakhand", 29.9457, 78.1642),
    ("Rishikesh", "Uttarakhand", 30.0869, 78.2676),
    ("Roorkee", "Uttarakhand", 29.8543, 77.8880),
    ("Nainital", "Uttarakhand", 29.3919, 79.4542),
    ("Haldwani", "Uttarakhand", 29.2183, 79.5130),
    ("Rudrapur", "Uttarakhand", 28.9800, 79.4000),
    ("Kashipur", "Uttarakhand", 29.2100, 78.9600),
    ("Almora", "Uttarakhand", 29.6000, 79.6600),
    ("Pithoragarh", "Uttarakhand", 29.5800, 80.2200),
    ("Uttarkashi", "Uttarakhand", 30.7300, 78.4400),
    ("Chamoli", "Uttarakhand", 30.4100, 79.3300),
    ("Shimla", "Himachal Pradesh", 31.1048, 77.1734),
    ("Dharamshala", "Himachal Pradesh", 32.2190, 76.3234),
    ("Manali", "Himachal Pradesh", 32.2432, 77.1892),
    ("Kullu", "Himachal Pradesh", 31.9579, 77.1095),
    ("Mandi", "Himachal Pradesh", 31.7087, 76.9320),
    ("Solan", "Himachal Pradesh", 30.9045, 77.0967),
    ("Chamba", "Himachal Pradesh", 32.5500, 76.1300),
    ("Hamirpur", "Himachal Pradesh", 31.6800, 76.5200),

    # ── Punjab & Chandigarh ───────────────────────────────────────────────────
    ("Chandigarh", "Chandigarh", 30.7333, 76.7794),
    ("Ludhiana", "Punjab", 30.9010, 75.8573),
    ("Amritsar", "Punjab", 31.6340, 74.8723),
    ("Jalandhar", "Punjab", 31.3260, 75.5762),
    ("Patiala", "Punjab", 30.3398, 76.3869),
    ("Bathinda", "Punjab", 30.2110, 74.9455),
    ("Pathankot", "Punjab", 32.2684, 75.6529),
    ("Hoshiarpur", "Punjab", 31.5273, 75.9149),
    ("Mohali", "Punjab", 30.7046, 76.7179),
    ("Firozpur", "Punjab", 30.9237, 74.6110),

    # ── Jammu & Kashmir & Ladakh ──────────────────────────────────────────────
    ("Srinagar", "Jammu & Kashmir", 34.0837, 74.7973),
    ("Jammu", "Jammu & Kashmir", 32.7266, 74.8570),
    ("Anantnag", "Jammu & Kashmir", 33.7311, 75.1522),
    ("Baramulla", "Jammu & Kashmir", 34.2000, 74.3400),
    ("Udhampur", "Jammu & Kashmir", 32.9254, 75.1416),
    ("Kathua", "Jammu & Kashmir", 32.3700, 75.5200),
    ("Leh", "Ladakh", 34.1526, 77.5771),
    ("Kargil", "Ladakh", 34.5539, 76.1349),

    # ── Rajasthan ─────────────────────────────────────────────────────────────
    ("Jaipur", "Rajasthan", 26.9124, 75.7873),
    ("Jodhpur", "Rajasthan", 26.2389, 73.0243),
    ("Udaipur", "Rajasthan", 24.5854, 73.7125),
    ("Kota", "Rajasthan", 25.2138, 75.8648),
    ("Bikaner", "Rajasthan", 28.0229, 73.3119),
    ("Ajmer", "Rajasthan", 26.4499, 74.6399),
    ("Alwar", "Rajasthan", 27.5530, 76.6346),
    ("Bharatpur", "Rajasthan", 27.2152, 77.5030),
    ("Bhilwara", "Rajasthan", 25.3475, 74.6408),
    ("Sikar", "Rajasthan", 27.6094, 75.1398),
    ("Pali", "Rajasthan", 25.7713, 73.3234),
    ("Sri Ganganagar", "Rajasthan", 29.9038, 73.8772),
    ("Barmer", "Rajasthan", 25.7532, 71.3967),
    ("Jaisalmer", "Rajasthan", 26.9157, 70.9083),
    ("Nagaur", "Rajasthan", 27.2025, 73.7423),
    ("Chittorgarh", "Rajasthan", 24.8887, 74.6269),
    ("Churu", "Rajasthan", 28.2900, 74.9600),
    ("Jhunjhunu", "Rajasthan", 28.1289, 75.3995),
    ("Banswara", "Rajasthan", 23.5461, 74.4371),

    # ── Madhya Pradesh ────────────────────────────────────────────────────────
    ("Bhopal", "Madhya Pradesh", 23.2599, 77.4126),
    ("Indore", "Madhya Pradesh", 22.7196, 75.8577),
    ("Jabalpur", "Madhya Pradesh", 23.1815, 79.9864),
    ("Gwalior", "Madhya Pradesh", 26.2183, 78.1828),
    ("Ujjain", "Madhya Pradesh", 23.1765, 75.7885),
    ("Sagar", "Madhya Pradesh", 23.8388, 78.7378),
    ("Dewas", "Madhya Pradesh", 22.9676, 76.0534),
    ("Satna", "Madhya Pradesh", 24.6005, 80.8322),
    ("Ratlam", "Madhya Pradesh", 23.3315, 75.0367),
    ("Rewa", "Madhya Pradesh", 24.5362, 81.3037),
    ("Singrauli", "Madhya Pradesh", 24.1992, 82.6645),
    ("Shivpuri", "Madhya Pradesh", 25.4319, 77.6599),
    ("Chhindwara", "Madhya Pradesh", 22.0574, 78.9382),
    ("Khandwa", "Madhya Pradesh", 21.8314, 76.3498),
    ("Khargone", "Madhya Pradesh", 21.8219, 75.6141),
    ("Katni", "Madhya Pradesh", 23.8343, 80.3957),
    ("Damoh", "Madhya Pradesh", 23.8323, 79.4418),
    ("Hoshangabad", "Madhya Pradesh", 22.7519, 77.7289),
    ("Seoni", "Madhya Pradesh", 22.0869, 79.5435),
    ("Balaghat", "Madhya Pradesh", 21.8049, 80.1849),

    # ── Gujarat ───────────────────────────────────────────────────────────────
    ("Ahmedabad", "Gujarat", 23.0225, 72.5714),
    ("Surat", "Gujarat", 21.1702, 72.8311),
    ("Vadodara", "Gujarat", 22.3072, 73.1812),
    ("Rajkot", "Gujarat", 22.3039, 70.8022),
    ("Bhavnagar", "Gujarat", 21.7645, 72.1519),
    ("Jamnagar", "Gujarat", 22.4707, 70.0577),
    ("Gandhinagar", "Gujarat", 23.2156, 72.6369),
    ("Junagadh", "Gujarat", 21.5222, 70.4579),
    ("Gandhidham", "Gujarat", 23.0753, 70.1337),
    ("Anand", "Gujarat", 22.5645, 72.9289),
    ("Navsari", "Gujarat", 20.9467, 72.9520),
    ("Morbi", "Gujarat", 22.8120, 70.8378),
    ("Nadiad", "Gujarat", 22.6916, 72.8634),
    ("Surendranagar", "Gujarat", 22.7284, 71.6371),
    ("Bharuch", "Gujarat", 21.7051, 72.9959),
    ("Porbandar", "Gujarat", 21.6417, 69.6293),
    ("Valsad", "Gujarat", 20.5992, 72.9342),
    ("Vapi", "Gujarat", 20.3893, 72.9106),
    ("Bhuj", "Gujarat", 23.2420, 69.6669),
    ("Mehsana", "Gujarat", 23.5880, 72.3693),
    ("Palanpur", "Gujarat", 24.1724, 72.4346),
    ("Veraval", "Gujarat", 20.9000, 70.3667),

    # ── Maharashtra & Goa ─────────────────────────────────────────────────────
    ("Mumbai", "Maharashtra", 19.0760, 72.8777),
    ("Pune", "Maharashtra", 18.5204, 73.8567),
    ("Nagpur", "Maharashtra", 21.1458, 79.0882),
    ("Thane", "Maharashtra", 19.2183, 72.9781),
    ("Nashik", "Maharashtra", 19.9975, 73.7898),
    ("Kalyan-Dombivli", "Maharashtra", 19.2403, 73.1305),
    ("Vasai-Virar", "Maharashtra", 19.3919, 72.8397),
    ("Chhatrapati Sambhajinagar", "Maharashtra", 19.8762, 75.3433),
    ("Navi Mumbai", "Maharashtra", 19.0330, 73.0297),
    ("Solapur", "Maharashtra", 17.6599, 75.9064),
    ("Mira-Bhayandar", "Maharashtra", 19.2812, 72.8561),
    ("Bhiwandi", "Maharashtra", 19.2967, 73.0631),
    ("Amravati", "Maharashtra", 20.9320, 77.7523),
    ("Nanded", "Maharashtra", 19.1383, 77.3210),
    ("Kolhapur", "Maharashtra", 16.7050, 74.2433),
    ("Akola", "Maharashtra", 20.7002, 77.0082),
    ("Panvel", "Maharashtra", 18.9894, 73.1175),
    ("Ulhasnagar", "Maharashtra", 19.2215, 73.1645),
    ("Sangli", "Maharashtra", 16.8524, 74.5815),
    ("Malegaon", "Maharashtra", 20.5539, 74.5288),
    ("Jalgaon", "Maharashtra", 21.0077, 75.5626),
    ("Latur", "Maharashtra", 18.4088, 76.5604),
    ("Dhule", "Maharashtra", 20.9042, 74.7749),
    ("Ahmednagar", "Maharashtra", 19.0948, 74.7480),
    ("Chandrapur", "Maharashtra", 19.9615, 79.2961),
    ("Parbhani", "Maharashtra", 19.2612, 76.7767),
    ("Jalna", "Maharashtra", 19.8410, 75.8864),
    ("Satara", "Maharashtra", 17.6805, 73.9997),
    ("Ratnagiri", "Maharashtra", 16.9902, 73.3120),
    ("Wardha", "Maharashtra", 20.7453, 78.6022),
    ("Yavatmal", "Maharashtra", 20.3888, 78.1204),
    ("Gondia", "Maharashtra", 21.4598, 80.1961),
    ("Alibag", "Maharashtra", 18.6584, 72.8773),
    ("Panaji", "Goa", 15.4909, 73.8278),
    ("Margao", "Goa", 15.2832, 73.9862),
    ("Vasco da Gama", "Goa", 15.3982, 73.8113),

    # ── Bihar & Jharkhand ─────────────────────────────────────────────────────
    ("Patna", "Bihar", 25.5941, 85.1376),
    ("Gaya", "Bihar", 24.7914, 85.0002),
    ("Bhagalpur", "Bihar", 25.2425, 86.9842),
    ("Muzaffarpur", "Bihar", 26.1209, 85.3647),
    ("Purnia", "Bihar", 25.7771, 87.4753),
    ("Darbhanga", "Bihar", 26.1542, 85.8918),
    ("Bihar Sharif", "Bihar", 25.1982, 85.5149),
    ("Arrah", "Bihar", 25.5560, 84.6603),
    ("Begusarai", "Bihar", 25.4182, 86.1272),
    ("Katihar", "Bihar", 25.5393, 87.5714),
    ("Munger", "Bihar", 25.3757, 86.4744),
    ("Chhapra", "Bihar", 25.7796, 84.7499),
    ("Motihari", "Bihar", 26.6470, 84.9089),
    ("Bettiah", "Bihar", 26.8020, 84.5026),
    ("Saharsa", "Bihar", 25.8835, 86.6006),
    ("Sasaram", "Bihar", 24.9522, 84.0315),
    ("Dehri", "Bihar", 24.8967, 84.1837),
    ("Siwan", "Bihar", 26.2200, 84.3600),
    ("Kishanganj", "Bihar", 26.1017, 87.9405),
    ("Ranchi", "Jharkhand", 23.3441, 85.3096),
    ("Jamshedpur", "Jharkhand", 22.8046, 86.2029),
    ("Dhanbad", "Jharkhand", 23.7957, 86.4304),
    ("Bokaro Steel City", "Jharkhand", 23.6693, 86.1511),
    ("Deoghar", "Jharkhand", 24.4826, 86.7003),
    ("Hazaribagh", "Jharkhand", 23.9937, 85.3637),
    ("Giridih", "Jharkhand", 24.1843, 86.3117),
    ("Ramgarh", "Jharkhand", 23.6337, 85.5147),
    ("Daltonganj", "Jharkhand", 24.0416, 84.0683),
    ("Dumka", "Jharkhand", 24.2678, 87.2492),
    ("Chaibasa", "Jharkhand", 22.5517, 85.8078),

    # ── West Bengal & Odisha ──────────────────────────────────────────────────
    ("Kolkata", "West Bengal", 22.5726, 88.3639),
    ("Howrah", "West Bengal", 22.5958, 88.2636),
    ("Asansol", "West Bengal", 23.6739, 86.9524),
    ("Siliguri", "West Bengal", 26.7271, 88.3953),
    ("Durgapur", "West Bengal", 23.5204, 87.3119),
    ("Bardhaman", "West Bengal", 23.2324, 87.8615),
    ("Malda", "West Bengal", 25.0108, 88.1411),
    ("Baharampur", "West Bengal", 24.0984, 88.2680),
    ("Kharagpur", "West Bengal", 22.3460, 87.2320),
    ("Darjeeling", "West Bengal", 27.0410, 88.2663),
    ("Jalpaiguri", "West Bengal", 26.5405, 88.7194),
    ("Purulia", "West Bengal", 23.3321, 86.3652),
    ("Balurghat", "West Bengal", 25.2197, 88.7656),
    ("Cooch Behar", "West Bengal", 26.3239, 89.4510),
    ("Bhubaneswar", "Odisha", 20.2961, 85.8245),
    ("Cuttack", "Odisha", 20.4625, 85.8828),
    ("Rourkela", "Odisha", 22.2604, 84.8536),
    ("Berhampur", "Odisha", 19.3149, 84.7941),
    ("Sambalpur", "Odisha", 21.4669, 83.9812),
    ("Puri", "Odisha", 19.8135, 85.8312),
    ("Balasore", "Odisha", 21.4934, 86.9135),
    ("Bhadrak", "Odisha", 21.0544, 86.4955),
    ("Baripada", "Odisha", 21.9322, 86.7297),
    ("Jharsuguda", "Odisha", 21.8554, 84.0064),
    ("Angul", "Odisha", 20.8415, 85.1015),
    ("Bolangir", "Odisha", 20.7107, 83.4851),
    ("Koraput", "Odisha", 18.8135, 82.7123),

    # ── Chhattisgarh ──────────────────────────────────────────────────────────
    ("Raipur", "Chhattisgarh", 21.2514, 81.6296),
    ("Bhilai", "Chhattisgarh", 21.2167, 81.4333),
    ("Bilaspur", "Chhattisgarh", 22.0797, 82.1409),
    ("Korba", "Chhattisgarh", 22.3595, 82.7501),
    ("Durg", "Chhattisgarh", 21.1904, 81.2849),
    ("Rajnandgaon", "Chhattisgarh", 21.0971, 81.0366),
    ("Jagdalpur", "Chhattisgarh", 19.0730, 82.0196),
    ("Ambikapur", "Chhattisgarh", 23.1187, 83.1979),
    ("Raigarh", "Chhattisgarh", 21.8974, 83.3950),

    # ── Northeast India ───────────────────────────────────────────────────────
    ("Guwahati", "Assam", 26.1445, 91.7362),
    ("Silchar", "Assam", 24.8333, 92.7789),
    ("Dibrugarh", "Assam", 27.4728, 94.9120),
    ("Jorhat", "Assam", 26.7509, 94.2037),
    ("Nagaon", "Assam", 26.3468, 92.6840),
    ("Tinsukia", "Assam", 27.4922, 95.3537),
    ("Tezpur", "Assam", 26.6528, 92.7926),
    ("Bongaigaon", "Assam", 26.5028, 90.5574),
    ("Dhubri", "Assam", 26.0200, 89.9800),
    ("Karimganj", "Assam", 24.8700, 92.3500),
    ("Agartala", "Tripura", 23.8315, 91.2868),
    ("Dharmanagar", "Tripura", 24.3739, 92.1628),
    ("Shillong", "Meghalaya", 25.5788, 91.8933),
    ("Tura", "Meghalaya", 25.5138, 90.2201),
    ("Imphal", "Manipur", 24.8170, 93.9368),
    ("Churachandpur", "Manipur", 24.3333, 93.6833),
    ("Aizawl", "Mizoram", 23.7271, 92.7176),
    ("Lunglei", "Mizoram", 22.8833, 92.7333),
    ("Kohima", "Nagaland", 25.6751, 94.1086),
    ("Dimapur", "Nagaland", 25.9064, 93.7271),
    ("Itanagar", "Arunachal Pradesh", 27.0844, 93.6053),
    ("Pasighat", "Arunachal Pradesh", 28.0667, 95.3333),
    ("Tawang", "Arunachal Pradesh", 27.5861, 91.8594),
    ("Gangtok", "Sikkim", 27.3389, 88.6065),

    # ── Karnataka ─────────────────────────────────────────────────────────────
    ("Bengaluru", "Karnataka", 12.9716, 77.5946),
    ("Mysuru", "Karnataka", 12.2958, 76.6394),
    ("Hubballi-Dharwad", "Karnataka", 15.3647, 75.1240),
    ("Mangaluru", "Karnataka", 12.9141, 74.8560),
    ("Belagavi", "Karnataka", 15.8497, 74.4977),
    ("Kalaburagi", "Karnataka", 17.3297, 76.8343),
    ("Davanagere", "Karnataka", 14.4644, 75.9218),
    ("Ballari", "Karnataka", 15.1394, 76.9214),
    ("Vijayapura", "Karnataka", 16.8302, 75.7100),
    ("Shivamogga", "Karnataka", 13.9299, 75.5681),
    ("Tumakuru", "Karnataka", 13.3409, 77.1006),
    ("Raichur", "Karnataka", 16.2120, 77.3439),
    ("Bidar", "Karnataka", 17.9104, 77.5199),
    ("Hosapete", "Karnataka", 15.2689, 76.3909),
    ("Hassan", "Karnataka", 13.0033, 76.1004),
    ("Udupi", "Karnataka", 13.3409, 74.7421),
    ("Karwar", "Karnataka", 14.8185, 74.1352),

    # ── Telangana & Andhra Pradesh ────────────────────────────────────────────
    ("Hyderabad", "Telangana", 17.3850, 78.4867),
    ("Warangal", "Telangana", 17.9689, 79.5941),
    ("Nizamabad", "Telangana", 18.6725, 78.0941),
    ("Karimnagar", "Telangana", 18.4386, 79.1288),
    ("Ramagundam", "Telangana", 18.7551, 79.5140),
    ("Khammam", "Telangana", 17.2473, 80.1514),
    ("Mahbubnagar", "Telangana", 16.7488, 77.9856),
    ("Nalgonda", "Telangana", 17.0577, 79.2684),
    ("Adilabad", "Telangana", 19.6641, 78.5320),
    ("Suryapet", "Telangana", 17.1439, 79.6236),
    ("Visakhapatnam", "Andhra Pradesh", 17.6868, 83.2185),
    ("Vijayawada", "Andhra Pradesh", 16.5062, 80.6480),
    ("Guntur", "Andhra Pradesh", 16.3067, 80.4365),
    ("Nellore", "Andhra Pradesh", 14.4426, 79.9865),
    ("Kurnool", "Andhra Pradesh", 15.8281, 78.0373),
    ("Kakinada", "Andhra Pradesh", 16.9891, 82.2475),
    ("Rajahmundry", "Andhra Pradesh", 17.0005, 81.8040),
    ("Kadapa", "Andhra Pradesh", 14.4673, 78.8242),
    ("Tirupati", "Andhra Pradesh", 13.6288, 79.4192),
    ("Anantapur", "Andhra Pradesh", 14.6819, 77.6006),
    ("Vizianagaram", "Andhra Pradesh", 18.1067, 83.3956),
    ("Eluru", "Andhra Pradesh", 16.7107, 81.0952),
    ("Ongole", "Andhra Pradesh", 15.5057, 80.0499),
    ("Nandyal", "Andhra Pradesh", 15.4889, 78.4839),
    ("Machilipatnam", "Andhra Pradesh", 16.1875, 81.1389),
    ("Srikakulam", "Andhra Pradesh", 18.2949, 83.8938),

    # ── Tamil Nadu & Puducherry ───────────────────────────────────────────────
    ("Chennai", "Tamil Nadu", 13.0827, 80.2707),
    ("Coimbatore", "Tamil Nadu", 11.0168, 76.9558),
    ("Madurai", "Tamil Nadu", 9.9252, 78.1198),
    ("Tiruchirappalli", "Tamil Nadu", 10.7905, 78.7047),
    ("Salem", "Tamil Nadu", 11.6643, 78.1460),
    ("Tirunelveli", "Tamil Nadu", 8.7139, 77.7567),
    ("Tiruppur", "Tamil Nadu", 11.1085, 77.3411),
    ("Vellore", "Tamil Nadu", 12.9165, 79.1325),
    ("Erode", "Tamil Nadu", 11.3410, 77.7172),
    ("Thoothukudi", "Tamil Nadu", 8.7642, 78.1348),
    ("Dindigul", "Tamil Nadu", 10.3673, 77.9803),
    ("Thanjavur", "Tamil Nadu", 10.7870, 79.1378),
    ("Ranipet", "Tamil Nadu", 12.9298, 79.3327),
    ("Sivakasi", "Tamil Nadu", 9.4533, 77.7946),
    ("Karur", "Tamil Nadu", 10.9601, 78.0766),
    ("Hosur", "Tamil Nadu", 12.7409, 77.8253),
    ("Nagercoil", "Tamil Nadu", 8.1833, 77.4119),
    ("Kanchipuram", "Tamil Nadu", 12.8342, 79.7036),
    ("Cuddalore", "Tamil Nadu", 11.7480, 79.7714),
    ("Kanyakumari", "Tamil Nadu", 8.0883, 77.5385),
    ("Puducherry", "Puducherry", 11.9416, 79.8083),

    # ── Kerala ────────────────────────────────────────────────────────────────
    ("Thiruvananthapuram", "Kerala", 8.5241, 76.9366),
    ("Kochi", "Kerala", 9.9312, 76.2673),
    ("Kozhikode", "Kerala", 11.2588, 75.7804),
    ("Kollam", "Kerala", 8.8932, 76.6141),
    ("Thrissur", "Kerala", 10.5276, 76.2144),
    ("Kannur", "Kerala", 11.8745, 75.3704),
    ("Alappuzha", "Kerala", 9.4981, 76.3388),
    ("Kottayam", "Kerala", 9.5916, 76.5222),
    ("Palakkad", "Kerala", 10.7867, 76.6548),
    ("Malappuram", "Kerala", 11.0732, 76.0740),
    ("Kasaragod", "Kerala", 12.4996, 74.9869),
    ("Pathanamthitta", "Kerala", 9.2648, 76.7870),
    ("Wayanad", "Kerala", 11.6103, 76.0827),
    ("Idukki", "Kerala", 9.8494, 76.9406),

    # ── Island Territories ────────────────────────────────────────────────────
    ("Port Blair", "Andaman & Nicobar", 11.6234, 92.7265),
    ("Car Nicobar", "Andaman & Nicobar", 9.1528, 92.8186),
    ("Kavaratti", "Lakshadweep", 10.5667, 72.6417),

    # ── Border River Basins (Himalayan / Subcontinental Edges) ────────────────
    ("Dhangadhi", "Nepal Border Basin", 28.6944, 80.5967),
    ("Nepalganj", "Nepal Border Basin", 28.0500, 81.6167),
    ("Birgunj", "Nepal Border Basin", 27.0167, 84.8667),
    ("Biratnagar", "Nepal Border Basin", 26.4525, 87.2718),
    ("Kathmandu", "Himalayan Basin", 27.7172, 85.3240),
    ("Pokhara", "Himalayan Basin", 28.2096, 83.9856),
    ("Sylhet", "Meghalaya-Sylhet Basin", 24.8949, 91.8687),
    ("Rangpur", "Brahmaputra Basin", 25.7439, 89.2752),
    ("Rajshahi", "Padma River Basin", 24.3745, 88.6042),
    ("Lahore", "Ravi River Basin", 31.5204, 74.3587),
    ("Sialkot", "Chenab River Basin", 32.4945, 74.5229),
]

_CITY_LATS = np.array([c[2] for c in MAJOR_INDIAN_CITIES], dtype=np.float64)
_CITY_LONS = np.array([c[3] for c in MAJOR_INDIAN_CITIES], dtype=np.float64)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute Haversine great-circle distance in kilometers."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2.0) ** 2
    return 2.0 * 6371.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def resolve_nearest_city(lat: float, lon: float) -> str:
    """
    Resolve a GPS coordinate (latitude, longitude) to the nearest Indian city / region.
    Formats result intuitively:
      - Within 25 km: 'Bareilly, Uttar Pradesh'
      - 25-80 km:     'Near Bareilly, Uttar Pradesh (~35 km)'
      - 80-160 km:    'Bareilly Basin, Uttar Pradesh'
      - Oceanic:      'Bay of Bengal (Offshore)' or 'Arabian Sea (Offshore)'
    """
    # Quick offshore water detection for marine coordinates in dataset
    if lon < 72.0 and lat < 18.5 and lat > 8.0:
        # Distance to mainland
        d_west = _haversine_km(lat, lon, lat, 73.0)
        if d_west > 150:
            return "Arabian Sea (Offshore Basin)"
    elif lon > 85.5 and lat < 18.0 and lat > 10.0:
        d_east = _haversine_km(lat, lon, lat, 83.5)
        if d_east > 160:
            # Check if closer to Andaman
            d_andaman = _haversine_km(lat, lon, 11.6234, 92.7265)
            if d_andaman > 180:
                return "Bay of Bengal (Offshore Basin)"

    # Fast Euclidean pre-filtering
    dlat = (_CITY_LATS - lat) * 111.0
    dlon = (_CITY_LONS - lon) * (111.0 * math.cos(math.radians(lat)))
    dist_approx = np.hypot(dlat, dlon)
    best_idx = int(np.argmin(dist_approx))

    # Exact Haversine for the closest candidate
    city_name, state_name, c_lat, c_lon = MAJOR_INDIAN_CITIES[best_idx]
    dist_km = _haversine_km(lat, lon, c_lat, c_lon)

    if dist_km <= 25.0:
        return f"{city_name}, {state_name}"
    elif dist_km <= 80.0:
        return f"Near {city_name}, {state_name} (~{int(dist_km)} km)"
    elif dist_km <= 160.0:
        return f"{city_name} Basin, {state_name}"
    else:
        return f"{city_name} Region, {state_name}"


def resolve_nearest_cities(lats: Sequence[float], lons: Sequence[float]) -> list[str]:
    """Batch-resolve multiple GPS coordinates quickly."""
    return [resolve_nearest_city(float(lat), float(lon)) for lat, lon in zip(lats, lons)]
