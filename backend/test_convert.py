import os
import sys

def test_convert():
    try:
        from docx2pdf import convert
        print("docx2pdf imported")
    except Exception as e:
        print("docx2pdf import error:", e)
        
    try:
        import comtypes.client
        print("comtypes imported")
    except Exception as e:
        print("comtypes import error:", e)

if __name__ == "__main__":
    test_convert()
