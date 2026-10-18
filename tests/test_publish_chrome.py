"""Offline tests: python3 -m unittest discover -s tests -p 'test_publish_chrome.py'."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "publish_chrome", Path(__file__).resolve().parents[1] / "scripts/publish-chrome.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublishChromeTests(unittest.TestCase):
    def setUp(self):
        self.env = {
            "CHROME_CLIENT_ID": "client", "CHROME_CLIENT_SECRET": "secret",
            "CHROME_REFRESH_TOKEN": "refresh", "CHROME_PUBLISHER_ID": "publisher",
            "CHROME_EXTENSION_ID": "a" * 32, "VERSION": "0.1.5",
        }
        self.content = b"Cr24test-only"
        self.sleep = Mock()

    def run_publish(self, responses):
        self.request = Mock(side_effect=responses)
        with patch.object(Path, "read_bytes", return_value=self.content), contextlib.redirect_stdout(io.StringIO()):
            module.publish(self.env, self.request, self.sleep)

    def test_sync_upload_and_publish(self):
        self.run_publish([{"access_token": "token"}, {},
                          {"uploadState": "SUCCEEDED", "crxVersion": "0.1.5"},
                          {"state": "PENDING_REVIEW"}])
        upload = self.request.call_args_list[2]
        self.assertEqual(upload.args, ("POST", f"{module.API}/upload/v2/publishers/publisher/items/{'a' * 32}:upload"))
        self.assertEqual(upload.kwargs["headers"]["X-Goog-Upload-Protocol"], "raw")
        self.assertEqual(upload.kwargs["headers"]["X-Goog-Upload-File-Name"], "chatgpt-backup-0.1.5-chrome.crx")
        self.assertEqual(upload.kwargs["data"], self.content)
        publish = self.request.call_args_list[3]
        self.assertTrue(publish.args[1].endswith(":publish"))
        self.assertEqual(json.loads(publish.kwargs["data"]), {"publishType": "DEFAULT_PUBLISH", "skipReview": False})
        self.sleep.assert_not_called()

    def test_async_upload(self):
        self.run_publish([{"access_token": "token"}, {}, {"uploadState": "IN_PROGRESS"},
                          {"lastAsyncUploadState": "IN_PROGRESS"},
                          {"lastAsyncUploadState": "SUCCEEDED"}, {"state": "PUBLISHED"}])
        self.assertEqual(self.sleep.call_count, 2)
        self.assertEqual(self.request.call_args_list[3].args[0], "GET")
        self.assertTrue(self.request.call_args_list[3].args[1].endswith(":fetchStatus"))

    def test_failure_and_unknown_state_never_publish(self):
        for state in ("FAILED", "NOT_FOUND", "SUCCESS", None):
            with self.subTest(state=state), self.assertRaises(RuntimeError):
                self.run_publish([{"access_token": "token"}, {}, {"uploadState": state}])
            self.assertEqual(self.request.call_count, 3)

    def test_async_failure(self):
        with self.assertRaises(RuntimeError):
            self.run_publish([{"access_token": "token"}, {}, {"uploadState": "IN_PROGRESS"},
                              {"lastAsyncUploadState": "FAILED"}])
        self.assertEqual(self.request.call_count, 4)

    def test_timeout_never_publishes(self):
        with self.assertRaises(RuntimeError):
            self.run_publish([{"access_token": "token"}, {}, {"uploadState": "IN_PROGRESS"}]
                             + [{"lastAsyncUploadState": "IN_PROGRESS"}] * 60)
        self.assertEqual(self.sleep.call_count, 60)

    def test_existing_review_or_staged_submission_blocks_upload(self):
        for state in ("PENDING_REVIEW", "STAGED"):
            with self.subTest(state=state), self.assertRaises(RuntimeError):
                self.run_publish([{"access_token": "token"},
                                  {"submittedItemRevisionStatus": {"state": state}}])
            self.assertEqual(self.request.call_count, 2)

    def test_already_published_blocks_upload(self):
        with self.assertRaises(RuntimeError):
            self.run_publish([{"access_token": "token"}, {"publishedItemRevisionStatus": {
                "distributionChannels": [{"crxVersion": "0.1.5"}]}}])
        self.assertEqual(self.request.call_count, 2)

    def test_version_mismatch_blocks_publish(self):
        with self.assertRaises(RuntimeError):
            self.run_publish([{"access_token": "token"}, {},
                              {"uploadState": "SUCCEEDED", "crxVersion": "0.1.4"}])
        self.assertEqual(self.request.call_count, 3)

    def test_missing_publisher_blocks_network(self):
        del self.env["CHROME_PUBLISHER_ID"]
        with self.assertRaises(ValueError):
            self.run_publish([])
        self.request.assert_not_called()

    def test_invalid_crx_blocks_network(self):
        self.content = b"PK-not-a-crx"
        with self.assertRaises(ValueError):
            self.run_publish([])
        self.request.assert_not_called()

    def test_rejected_publication_fails(self):
        with self.assertRaises(RuntimeError):
            self.run_publish([{"access_token": "token"}, {},
                              {"uploadState": "SUCCEEDED"}, {"state": "REJECTED"}])


if __name__ == "__main__":
    unittest.main()
