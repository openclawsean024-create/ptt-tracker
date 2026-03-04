#!/usr/bin/env python3
"""
PTT 文章追蹤器
追蹤熱門文章，關鍵字通知
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import os
import sys
import argparse
from datetime import datetime
import hashlib

# PTT 網址
PTT_URL = "https://www.ptt.cc"

# 預設看板
DEFAULT_BOARDS = ["Gossiping", "Tech_Job", "Stock", "AI", "MobileComm", "Food"]

# 熱度閾值
DEFAULT_MIN_HEAT = 10

class PTTTracker:
    def __init__(self, boards=None, keywords=None, min_heat=10):
        self.boards = boards or DEFAULT_BOARDS
        self.keywords = keywords or []
        self.min_heat = min_heat
        self.session = requests.Session()
        
        # 設定 Cookie 表明已滿 18 歲
        self.session.cookies.set('over18', '1')
        
        # 儲存已讀文章
        self.read_file = "read_articles.json"
        self.read_articles = self.load_read_articles()
    
    def load_read_articles(self):
        """載入已讀文章"""
        if os.path.exists(self.read_file):
            try:
                with open(self.read_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def save_read_articles(self):
        """儲存已讀文章"""
        try:
            with open(self.read_file, 'w', encoding='utf-8') as f:
                json.dump(self.read_articles, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"儲存失敗: {e}")
    
    def get_article_hash(self, title, date):
        """產生文章 hash"""
        return hashlib.md5(f"{title}_{date}".encode()).hexdigest()
    
    def is_article_read(self, article_hash):
        """檢查文章是否已讀"""
        return article_hash in self.read_articles
    
    def mark_as_read(self, article_hash):
        """標記為已讀"""
        self.read_articles[article_hash] = datetime.now().isoformat()
        self.save_read_articles()
    
    def get_board_articles(self, board, limit=20):
        """取得看板文章"""
        url = f"{PTT_URL}/bbs/{board}/index.html"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        try:
            response = self.session.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # 找到文章列表
            articles = []
            for item in soup.select('div.r-ent'):
                try:
                    # 取得文章標題
                    title_elem = item.select_one('div.title a')
                    if not title_elem:
                        continue
                    
                    title = title_elem.get_text(strip=True)
                    
                    # 取得文章連結
                    href = title_elem.get('href', '')
                    if not href:
                        continue
                    
                    # 取得作者
                    author = item.select_one('div.author')
                    author = author.get_text(strip=True) if author else "未知"
                    
                    # 取得日期
                    date_elem = item.select_one('div.date')
                    date = date_elem.get_text(strip=True) if date_elem else ""
                    
                    # 取得推文數
                    push_elem = item.select_one('span.hl')
                    pushes = push_elem.get_text(strip=True) if push_elem else "0"
                    try:
                        pushes = int(pushes)
                    except:
                        pushes = 0
                    
                    # 計算熱度
                    heat = pushes
                    
                    articles.append({
                        'title': title,
                        'href': href,
                        'author': author,
                        'date': date,
                        'pushes': pushes,
                        'heat': heat,
                        'board': board
                    })
                    
                except Exception as e:
                    continue
            
            return articles[:limit]
            
        except Exception as e:
            print(f"取得看板 {board} 失敗: {e}")
            return []
    
    def match_keywords(self, title):
        """檢查標題是否包含關鍵字"""
        if not self.keywords:
            return False
        
        title_lower = title.lower()
        for keyword in self.keywords:
            if keyword.lower() in title_lower:
                return True
        return False
    
    def check_boards(self):
        """檢查所有看板"""
        all_new_articles = []
        keyword_matches = []
        
        for board in self.boards:
            print(f"\n📋 檢查看板: {board}...")
            articles = self.get_board_articles(board, limit=30)
            
            for article in articles:
                article_hash = self.get_article_hash(article['title'], article['date'])
                
                # 檢查是否已讀
                if self.is_article_read(article_hash):
                    continue
                
                # 標記為已讀
                self.mark_as_read(article_hash)
                
                # 檢查熱度
                if article['heat'] >= self.min_heat:
                    all_new_articles.append(article)
                
                # 檢查關鍵字
                if self.match_keywords(article['title']):
                    keyword_matches.append(article)
        
        return all_new_articles, keyword_matches
    
    def format_article(self, article):
        """格式化文章資訊"""
        pushes_emoji = "🔥" if article['pushes'] >= 50 else "⚡" if article['pushes'] >= 20 else "💬"
        
        return f"""
{pushes_emoji} 【{article['board']}】 {article['pushes']} 推
標題: {article['title']}
作者: {article['author']}
日期: {article['date']}
連結: {PTT_URL}{article['href']}
"""
    
    def run(self):
        """執行追蹤"""
        print(f"\n🤖 PTT 文章追蹤器啟動")
        print(f"📌 追蹤看板: {', '.join(self.boards)}")
        if self.keywords:
            print(f"🔑 關鍵字: {', '.join(self.keywords)}")
        print(f"🔥 熱度閾值: {self.min_heat}")
        print("-" * 40)
        
        new_articles, keyword_matches = self.check_boards()
        
        # 顯示結果
        if keyword_matches:
            print("\n🔔 關鍵字匹配文章:")
            for article in keyword_matches:
                print(self.format_article(article))
        
        if new_articles:
            print(f"\n🔥 熱門文章 ({len(new_articles)} 篇):")
            for article in sorted(new_articles, key=lambda x: x['heat'], reverse=True)[:10]:
                print(self.format_article(article))
        
        if not keyword_matches and not new_articles:
            print("\n✅ 沒有新的熱門文章或關鍵字匹配")
        
        print("\n" + "=" * 40)
        print(f"完成時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        return keyword_matches, new_articles


def load_config():
    """載入設定檔"""
    config_file = "config.json"
    
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    
    return {}


def main():
    parser = argparse.ArgumentParser(description='PTT 文章追蹤器')
    parser.add_argument('--boards', nargs='+', help='指定看板')
    parser.add_argument('--keywords', nargs='+', help='關鍵字')
    parser.add_argument('--min-heat', type=int, default=DEFAULT_MIN_HEAT, help='熱度閾值')
    parser.add_argument('--interval', type=int, help='循環間隔（分鐘）')
    
    args = parser.parse_args()
    
    # 載入設定
    config = load_config()
    
    # 參數優先順序：命令列 > 設定檔 > 預設
    boards = args.boards or config.get('boards', DEFAULT_BOARDS)
    keywords = args.keywords or config.get('keywords', [])
    min_heat = args.min_heat or config.get('min_heat', DEFAULT_MIN_HEAT)
    
    tracker = PTTTracker(boards=boards, keywords=keywords, min_heat=min_heat)
    
    if args.interval:
        # 循環模式
        print(f"\n🔄 循環模式: 每 {args.interval} 分鐘檢查一次")
        print("按 Ctrl+C 停止\n")
        
        try:
            while True:
                tracker.run()
                print(f"\n💤 等待 {args.interval} 分鐘...")
                time.sleep(args.interval * 60)
        except KeyboardInterrupt:
            print("\n\n👋 已停止")
    else:
        # 單次模式
        tracker.run()


if __name__ == '__main__':
    main()
