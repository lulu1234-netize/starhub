#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生日提醒脚本（StarHub 云端版，由 GitHub Actions 每天北京时间 00:00 调用）
- 读取仓库里的 data/birthdays.json（字段：name / birthday  MM-DD / early  bool）
- 当天是某联系人生日            -> 发「生日提醒」邮件
- 该联系人勾选了 early，且当天是其生日前 14 天 -> 发「购礼提醒」邮件
- 跨年（如 1 月生日的提前提醒落在去年 12 月）自动正确处理
"""
import json
import os
import smtplib
import ssl
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "birthdays.json")
TO_EMAIL_DEFAULT = "2639774644@qq.com"


def china_today() -> date:
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).date()


def safe_date(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError:
        return date(year, month, 28)


def next_birthday(month: int, day: int, today: date) -> date:
    cand = safe_date(today.year, month, day)
    if cand < today:
        cand = safe_date(today.year + 1, month, day)
    return cand


def send_email(subject: str, body: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ["SMTP_USER"]
    pwd = os.environ["SMTP_PASS"]
    to = os.environ.get("TO_EMAIL") or TO_EMAIL_DEFAULT

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = to
    msg.set_content(body)

    if port == 465:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=ctx) as server:
            server.login(user, pwd)
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port) as server:
            server.starttls()
            server.login(user, pwd)
            server.send_message(msg)


def main() -> None:
    if not os.path.exists(DATA_FILE):
        print("未找到 data/birthdays.json，跳过。")
        return

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        contacts = json.load(f)

    today = china_today()
    sent = 0

    for c in contacts:
        name = c.get("name", "")
        birthday = c.get("birthday", "")
        if not name or not birthday:
            continue
        try:
            month, day = map(int, birthday.split("-"))
        except ValueError:
            print(f"跳过无效生日格式：{name} -> {birthday}")
            continue

        nb = next_birthday(month, day, today)
        early = nb - timedelta(days=14)

        if today == nb:
            send_email(
                f"生日提醒：今天是 {name} 的生日",
                f"你好，\n\n今天是 {name} 的生日（{birthday}），记得送上祝福！\n\n—— 星汇生日提醒",
            )
            sent += 1

        if c.get("early") and today == early:
            send_email(
                f"购礼提醒：{name} 的生日还有 14 天",
                f"你好，\n\n{name} 的生日是 {birthday}，距今还有 14 天。提前准备礼物更从容哦。\n\n—— 星汇生日提醒",
            )
            sent += 1

    print(f"处理完成，今日共发送 {sent} 封邮件。")


if __name__ == "__main__":
    main()
